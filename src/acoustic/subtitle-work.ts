import type { AlignmentMode, SubtitleLine, AlignedLine } from "../shared/types";
import type { AcousticInput, RecognitionInput } from "./model-session";
import type { JobKey, TimeRange, Segment } from "./contracts";
import type { RangeAudioSource } from "./progressive-audio-source";
import {
  createAlignmentPolicy,
  missingAudioRanges,
  type AlignmentProgress,
} from "./alignment-policy";
import {
  locateLyrics,
  pendingLineIdsForWindow,
  type LocationResult,
} from "./lyric-locator";
import {
  createTimingDiagnostics,
  type DecodeTimingObserver,
  type TimingReport,
  type OperationOutcome,
} from "./timing-diagnostics";
import { lockTiming, mergeTiming } from "../lyrics/timing-locks";
import { validateSegment, AcousticBoundaryError } from "./validate-segment";
import { acousticGapSegments, contextualGapSegments } from "./acoustic-gaps";
export interface WorkModel {
  prepare(): Promise<void>;
  transcribe(input: RecognitionInput): Promise<string>;
  readings?(texts: string[]): Promise<string[]>;
  align(input: AcousticInput): Promise<AlignedLine[]>;
  verify?(input: AcousticInput): Promise<AlignedLine[]>;
  cancel(): Promise<void>;
}
export async function runSubtitleAlignment(
  input: {
    key: JobKey;
    lines: SubtitleLine[];
    durationMs: number;
    mode: AlignmentMode;
    signal: AbortSignal;
    resume?: Pick<AlignmentProgress, "checked" | "ready">;
  },
  deps: {
    source: (onDecode?: DecodeTimingObserver) => RangeAudioSource;
    model: WorkModel;
    positionMs: () => number;
    publish: (progress: AlignmentProgress) => void;
    onDiagnostics?: (report: TimingReport) => void;
    diagnostic?: (event: {
      range: TimeRange;
      code: "location" | "boundary";
      lineIds: string[];
      message: string;
    }) => void;
  },
): Promise<AlignmentProgress> {
  let lines = input.lines.map((l) => lockTiming(l, input.durationMs));
  const diagnostics = createTimingDiagnostics(input.key, lines, {
    publish: deps.onDiagnostics,
    aborted: () => input.signal.aborted,
  });
  let outcome: TimingReport["outcome"] = "running";
  const model: WorkModel = {
    prepare: () =>
      diagnostics.measureAsync("prepare", () => deps.model.prepare()),
    transcribe: (value) =>
      diagnostics.measureAsync("recognize", () => deps.model.transcribe(value)),
    readings: deps.model.readings
      ? (value) =>
          diagnostics.measureAsync("readings", () =>
            deps.model.readings!(value),
          )
      : undefined,
    align: (value) =>
      diagnostics.measureAsync(
        "align",
        () => deps.model.align(value),
        value.segment,
      ),
    verify: deps.model.verify
      ? (value) =>
          diagnostics.measureAsync(
            "verify",
            () => deps.model.verify!(value),
            value.segment,
          )
      : undefined,
    cancel: () => deps.model.cancel(),
  };
  let audio: RangeAudioSource | undefined,
    sequence = 0;
  const incoming = new Set(
    lines
      .filter((l) => l.startMs !== undefined || l.endMs !== undefined)
      .map((l) => l.id),
  );
  const silentReady: TimeRange[] = [];
  const checked: TimeRange[] = structuredClone(input.resume?.checked ?? []),
    ready: TimeRange[] = [
      ...structuredClone(input.resume?.ready ?? []),
      ...lines
        .filter(
          (l) =>
            !l.excluded && l.startMs !== undefined && l.endMs !== undefined,
        )
        .map((l) => ({ startMs: l.startMs!, endMs: l.endMs! })),
    ],
    policy = createAlignmentPolicy(input.mode, input.durationMs);
  const passChecked: TimeRange[] = structuredClone(input.resume?.checked ?? []);
  const recognitionCache = new Map<
    string,
    {
      generation: number;
      recognitions: NonNullable<LocationResult["recognitions"]>;
    }
  >();
  const timedCount = () =>
    lines.filter((l) => l.startMs !== undefined && l.endMs !== undefined)
      .length;
  let pass = 0,
    passStartCount = timedCount();
  let refining = false,
    refinementRanges: TimeRange[] = [];
  const complete = () =>
    lines.every(
      (l) => l.excluded || (l.startMs !== undefined && l.endMs !== undefined),
    );
  const publish = (phase: AlignmentProgress["phase"], error?: string) => {
    diagnostics.update(lines);
    ready.sort((a, b) => a.startMs - b.startMs);
    for (let i = 1; i < ready.length;)
      if (ready[i].startMs <= ready[i - 1].endMs) {
        ready[i - 1].endMs = Math.max(ready[i - 1].endMs, ready[i].endMs);
        ready.splice(i, 1);
      } else i++;
    const progress: AlignmentProgress = {
      key: input.key,
      mode: input.mode,
      generation: audio?.generation ?? 0,
      sequence: ++sequence,
      lines: structuredClone(lines),
      checked: [...checked],
      ready: [...ready],
      phase,
      error,
    };
    deps.publish(progress);
    return progress;
  };
  const check = () => {
    if (input.signal.aborted) throw new Error("工作已取消");
  };
  if (complete()) {
    diagnostics.finish("complete");
    return publish("complete");
  }
  const abort = () => {
    void deps.model.cancel().catch(() => {});
    audio?.dispose();
  };
  input.signal.addEventListener("abort", abort, { once: true });
  try {
    check();
    publish("loading");
    await model.prepare();
    check();
    audio = deps.source(diagnostics.decode);
    while (!complete()) {
      check();
      const range = refining
        ? refinementRanges.find(
            (r) =>
              !passChecked.some(
                (c) => c.startMs === r.startMs && c.endMs === r.endMs,
              ),
          )
        : policy.nextRanges(deps.positionMs(), passChecked)[0];
      if (!range) {
        // New endpoints can disambiguate an earlier chorus. Reuse audio-only
        // recognition, but never reuse it across an ad/source generation reset.
        if (++pass >= 4 || timedCount() <= passStartCount) {
          if (refining) break;
          refining = true;
          pass = 0;
        }
        passStartCount = timedCount();
        passChecked.length = 0;
        if (refining)
          refinementRanges = missingAudioRanges(lines, input.durationMs);
        if (refining && !refinementRanges.length) break;
        continue;
      }
      diagnostics.update(lines);
      const endWindow = diagnostics.window(
        range,
        `${refining ? "refine" : "scan"}-${pass + 1}`,
        audio.generation,
      );
      let windowOutcome: OperationOutcome | "stale" = "ok";
      try {
        publish("buffering");
        try {
          await diagnostics.measureAsync(
            "audio-wait",
            () => audio!.ensure(range, input.signal),
            range,
          );
        } catch (error) {
          diagnostics.mark(
            pendingLineIdsForWindow(lines, range),
            "audio-unavailable",
          );
          throw error;
        }
        check();
        const generation = audio.generation;
        publish("running");
        const location = await locateLyrics(
          lines,
          range,
          audio,
          model,
          input.signal,
          recognitionCache.get(`${range.startMs}:${range.endMs}`),
          diagnostics,
        );
        if (generation !== audio.generation) {
          windowOutcome = "stale";
          continue;
        }
        diagnostics.mark(pendingLineIdsForWindow(lines, range), "unlocated");
        diagnostics.mark(location.ambiguousLineIds, "ambiguous");
        deps.diagnostic?.({
          range,
          code: "location",
          lineIds: location.segments.flatMap((s) => s.lineIds),
          message: JSON.stringify({
            recognitions: location.recognitions,
            ambiguousLineIds: location.ambiguousLineIds,
          }),
        });
        if (location.recognitions)
          recognitionCache.set(`${range.startMs}:${range.endMs}`, {
            generation,
            recognitions: location.recognitions,
          });
        const segments = [...location.segments];
        for (const segment of segments) {
          let candidate = segment;
          for (let attempt = 0; attempt < 2; attempt++) {
            const missingResultIds = new Set<string>();
            try {
              await diagnostics.measureAsync(
                "audio-wait",
                () => audio!.ensure(candidate, input.signal),
                candidate,
              );
              const { pcm } = await diagnostics.measureAsync(
                "pcm-read",
                () => audio!.read(candidate.startMs, candidate.endMs),
                candidate,
              );
              const result = await model.align({
                segment: candidate,
                lines: location.contexts?.[segment.id]?.alignmentLines ?? lines,
                pcm,
                leadingText: location.contexts?.[segment.id]?.leadingText,
                trailingText: location.contexts?.[segment.id]?.trailingText,
              });
              check();
              if (generation !== audio.generation) break;
              const owned = lines.filter((l) =>
                candidate.lineIds.includes(l.id),
              );
              for (const id of candidate.lineIds)
                if (
                  !result.some(
                    (row) =>
                      row.id === id &&
                      row.startMs !== undefined &&
                      row.endMs !== undefined,
                  )
                )
                  missingResultIds.add(id);
              diagnostics.mark([...missingResultIds], "alignment-no-result");
              const validation = diagnostics.measure(
                "validate",
                () => validateSegment(result, candidate, lines),
                candidate,
              );
              if (!validation.ok)
                throw new AcousticBoundaryError(validation.reason);
              const found = new Map(result.map((l) => [l.id, l]));
              lines = lines.map((l) =>
                found.has(l.id)
                  ? mergeTiming(l, found.get(l.id)!, input.durationMs)
                  : l,
              );
              for (const l of owned) {
                const updated = lines.find((x) => x.id === l.id)!;
                if (
                  updated.startMs !== undefined &&
                  updated.endMs !== undefined
                )
                  ready.push({
                    startMs: updated.startMs,
                    endMs: updated.endMs,
                  });
              }
              break;
            } catch (error) {
              if (input.signal.aborted) throw error;
              if (!(error instanceof AcousticBoundaryError)) throw error;
              diagnostics.mark(
                candidate.lineIds.filter((id) => !missingResultIds.has(id)),
                "boundary-rejected",
              );
              deps.diagnostic?.({
                range: candidate,
                code: "boundary",
                lineIds: candidate.lineIds,
                message: error.message,
              });
              if (location.fallbacks?.[segment.id]) {
                segments.push(...location.fallbacks[segment.id]);
                break;
              }
              // Reusing recognized context with different PCM would misalign it.
              if (location.contexts?.[segment.id]) break;
              if (attempt === 1) break;
              candidate = {
                ...segment,
                startMs: Math.max(0, segment.startMs - 2000),
                endMs: Math.min(input.durationMs, segment.endMs + 2000),
              };
              if (candidate.endMs - candidate.startMs > 30000)
                candidate.endMs = candidate.startMs + 30000;
            }
          }
        }
        if (generation !== audio.generation) {
          windowOutcome = "stale";
          continue;
        }
        passChecked.push(range);
        if (
          !checked.some(
            (r) => r.startMs === range.startMs && r.endMs === range.endMs,
          )
        )
          checked.push(range);
        ready.push(...location.silent);
        silentReady.push(...location.silent);
        // Union verified windows; unknown/ambiguous windows never unlock playback.
        publish("running");
      } catch (error) {
        windowOutcome = input.signal.aborted ? "cancelled" : "failed";
        throw error;
      } finally {
        diagnostics.update(lines);
        endWindow(windowOutcome);
      }
    }
    // ASR can miss rap or proper names even after the surrounding lines have
    // localized the audio. Verify source text against actual PCM and a silence
    // control; only the real-audio alignment may provide missing endpoints.
    if (model.verify) {
      const verify = async (
        requested: Segment,
        repairIds = new Set<string>(),
      ) => {
        diagnostics.update(lines);
        const endWindow = diagnostics.window(
          requested,
          repairIds.size ? "context-verification" : "gap-verification",
          audio!.generation,
        );
        let windowOutcome: OperationOutcome | "stale" = "ok";
        try {
          check();
          publish("buffering");
          try {
            await diagnostics.measureAsync(
              "audio-wait",
              () => audio!.ensure(requested, input.signal),
              requested,
            );
          } catch (error) {
            diagnostics.mark(requested.lineIds, "audio-unavailable");
            throw error;
          }
          const candidate = {
            ...requested,
            ...audio!.readableRange(requested),
          };
          const generation = audio!.generation;
          const { pcm } = await diagnostics.measureAsync(
            "pcm-read",
            () => audio!.read(candidate.startMs, candidate.endMs),
            candidate,
          );
          publish("running");
          const result = await model.verify!({
            segment: candidate,
            lines,
            pcm,
          });
          check();
          if (generation !== audio!.generation) {
            windowOutcome = "stale";
            return true;
          }
          diagnostics.mark(
            candidate.lineIds.filter(
              (id) =>
                !result.some(
                  (row) =>
                    row.id === id &&
                    row.startMs !== undefined &&
                    row.endMs !== undefined,
                ),
            ),
            "verification-no-match",
          );
          if (!result.length) return false;
          if (result.some((row) => !candidate.lineIds.includes(row.id)))
            throw new Error("聲學驗證回傳了未要求的句子");
          // Updating neighbors alone must never count as resolving a missing vocal.
          if (repairIds.size && !result.some((row) => !repairIds.has(row.id)))
            return false;
          const verified = result.map((row) => {
            const original = lines.find((l) => l.id === row.id)!;
            if (
              row.original !== original.original ||
              row.excluded !== original.excluded
            )
              throw new Error("聲學驗證改變原文或排除狀態");
            if (repairIds.has(row.id)) {
              if (incoming.has(row.id))
                throw new Error("不可修訂工作開始前的有效端點");
              return mergeTiming(
                {
                  ...original,
                  startMs: undefined,
                  endMs: undefined,
                  timing: {},
                },
                row,
                input.durationMs,
              );
            }
            return mergeTiming(original, row, input.durationMs);
          });
          const selected = {
            ...candidate,
            lineIds: verified.map((row) => row.id),
          };
          const validation = diagnostics.measure(
            "validate",
            () => validateSegment(verified, selected, lines),
            candidate,
          );
          if (!validation.ok) {
            diagnostics.mark(selected.lineIds, "boundary-rejected");
            deps.diagnostic?.({
              range: candidate,
              code: "boundary",
              lineIds: selected.lineIds,
              message: validation.reason!,
            });
            return false;
          }
          const found = new Map(verified.map((l) => [l.id, l]));
          lines = lines.map((l) => found.get(l.id) ?? l);
          // A superseded estimate must not leave its old coverage ready.
          ready.splice(
            0,
            ready.length,
            ...silentReady,
            ...lines.flatMap((l) =>
              !l.excluded && l.startMs !== undefined && l.endMs !== undefined
                ? [{ startMs: l.startMs, endMs: l.endMs }]
                : [],
            ),
          );
          publish("running");
          return false;
        } catch (error) {
          windowOutcome = input.signal.aborted ? "cancelled" : "failed";
          throw error;
        } finally {
          diagnostics.update(lines);
          endWindow(windowOutcome);
        }
      };
      for (let pass = 0; pass < 4 && !complete(); pass++) {
        const before = timedCount();
        let reset = false;
        for (const requested of acousticGapSegments(lines, input.durationMs)) {
          reset = (await verify(requested)) || reset;
        }
        if (!reset && timedCount() <= before) break;
      }
      for (let pass = 0; pass < 4 && !complete(); pass++) {
        const before = timedCount();
        let reset = false;
        for (const candidate of contextualGapSegments(lines, incoming))
          reset =
            (await verify(candidate.segment, candidate.repairIds)) || reset;
        if (!reset && timedCount() <= before) break;
      }
    }
    outcome = complete() ? "complete" : "partial";
    return publish(
      complete() ? "complete" : "partial",
      complete() ? undefined : "部分句子沒有可靠定位，文字與已完成時間均已保留",
    );
  } catch (error) {
    outcome = input.signal.aborted ? "cancelled" : "failed";
    publish(
      input.signal.aborted ? "cancelled" : "failed",
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  } finally {
    input.signal.removeEventListener("abort", abort);
    audio?.dispose();
    try {
      await diagnostics.measureAsync("cleanup", () => deps.model.cancel());
    } catch (error) {
      outcome = input.signal.aborted ? "cancelled" : "failed";
      throw error;
    } finally {
      diagnostics.update(lines);
      diagnostics.finish(outcome);
    }
  }
}
