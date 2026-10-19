import type { AlignedLine, Cue } from "../shared/types";
import type { AudioSource } from "./audio-source";
import type { AcousticInput, RecognitionInput } from "./model-session";
import { prepareAcousticContext } from "./audio-context";
import { AcousticBoundaryError } from "./validate-segment";
import {
  assertSegmentLines,
  type Segment,
  type SegmentState,
} from "./contracts";
interface Session {
  retain(): void;
  release(): void;
  cancel(): void;
  align(input: AcousticInput): Promise<AlignedLine[]>;
  transcribe?(input: RecognitionInput): Promise<string>;
}
export function createScheduler(
  segments: Segment[],
  lines: AlignedLine[],
  audio: AudioSource,
  session: Session,
  publish: (
    segment: Segment,
    lines: AlignedLine[],
    repairedContext?: AlignedLine[],
  ) => Promise<void>,
  onFailure: (segment: Segment, error: unknown) => void = () => {},
  cues: Cue[] = [],
) {
  lines = structuredClone(lines);
  const onVerified = async (
    segment: Segment,
    result: AlignedLine[],
    repairedContext: AlignedLine[] = [],
  ) => {
    await publish(segment, result, repairedContext);
    const verified = new Map(
      [...repairedContext, ...result].map((line) => [line.id, line]),
    );
    lines = lines.map((line) => verified.get(line.id) ?? line);
  };
  const owners = new Set<string>(),
    ids = new Set<string>();
  for (const segment of segments) {
    assertSegmentLines(
      segment,
      lines.map((l) => l.id),
    );
    if (ids.has(segment.id)) throw new Error("片段 ID 重複");
    ids.add(segment.id);
    for (const id of segment.lineIds) {
      if (owners.has(id)) throw new Error("歌詞有多個 owner");
      owners.add(id);
    }
  }
  let position = 0,
    running = false;
  return {
    updatePosition(ms: number) {
      if (Number.isFinite(ms) && ms >= 0) position = ms;
    },
    async run(signal: AbortSignal) {
      if (running) throw new Error("排程已執行");
      running = true;
      const states: Record<string, SegmentState> = Object.fromEntries(
        segments.map((s) => [s.id, "pending"]),
      );
      const abort = () => session.cancel();
      signal.addEventListener("abort", abort);
      session.retain();
      const deadline = Date.now() + 600000;
      try {
        while (!signal.aborted && Date.now() < deadline) {
          const pending = segments.filter((s) => states[s.id] === "pending");
          if (!pending.length) break;
          const priority = (s: Segment) =>
            s.startMs <= position && position < s.endMs
              ? 0
              : s.startMs >= position
                ? 1
                : 2;
          pending.sort(
            (a, b) => priority(a) - priority(b) || a.startMs - b.startMs,
          );
          const ownerSegment = pending[0];
          const available = audio
            .availableRanges()
            .find(
              (r) =>
                r.startMs <= ownerSegment.startMs &&
                r.endMs >= ownerSegment.endMs,
            );
          const padding = Math.min(
            2000,
            (30000 - (ownerSegment.endMs - ownerSegment.startMs)) / 2,
          );
          let segment = available
            ? {
                ...ownerSegment,
                startMs: Math.max(
                  available.startMs,
                  ownerSegment.startMs - padding,
                ),
                endMs: Math.min(available.endMs, ownerSegment.endMs + padding),
              }
            : ownerSegment;
          if (
            !audio
              .availableRanges()
              .some(
                (r) => r.startMs <= segment.startMs && r.endMs >= segment.endMs,
              )
          ) {
            states[segment.id] = "waiting-audio";
            continue;
          }
          states[segment.id] = "running";
          try {
            const prepared = await prepareAcousticContext(
              ownerSegment,
              lines,
              segments,
              cues,
              audio,
              session,
              signal,
            );
            segment = prepared.segment;
            const { pcm } = await audio.read(segment.startMs, segment.endMs);
            if (signal.aborted) break;
            const result = await session.align({ ...prepared, pcm });
            if (signal.aborted) break;
            try {
              await onVerified(segment, result);
            } catch (error) {
              const margin = Math.min(
                4000,
                (30000 - (segment.endMs - segment.startMs)) / 2,
              );
              const range = audio
                .availableRanges()
                .find(
                  (r) =>
                    r.startMs <= segment.startMs && r.endMs >= segment.endMs,
                );
              if (!(error instanceof AcousticBoundaryError) || !range)
                throw error;
              const first = lines.findIndex((l) => l.id === segment.lineIds[0]),
                last = lines.findIndex((l) => l.id === segment.lineIds.at(-1));
              const neighbors = [lines[first - 1], lines[last + 1]]
                .filter((l) => l && !l.excluded)
                .map((l) => l.id);
              const expanded = {
                ...segment,
                contextLineIds: [
                  ...new Set([...segment.contextLineIds, ...neighbors]),
                ].filter((id) => !segment.lineIds.includes(id)),
                startMs: Math.max(range.startMs, segment.startMs - margin),
                endMs: Math.min(range.endMs, segment.endMs + margin),
              };
              const previous = lines[first - 1];
              const repairPrevious =
                previous &&
                previous.status !== "manual" &&
                previous.startMs !== undefined &&
                previous.endMs !== undefined &&
                previous.startMs >= expanded.startMs;
              const joint = repairPrevious
                ? {
                    ...expanded,
                    startMs: Math.max(range.startMs, previous.startMs! - 200),
                    lineIds: [previous.id, ...expanded.lineIds],
                    contextLineIds: expanded.contextLineIds.filter(
                      (id) => id !== previous.id,
                    ),
                  }
                : expanded;
              const retryContext = repairPrevious
                ? await prepareAcousticContext(
                    joint,
                    lines,
                    segments,
                    cues,
                    audio,
                    session,
                    signal,
                  )
                : { segment: joint, lines, leadingText: prepared.leadingText };
              const retry = await audio.read(
                retryContext.segment.startMs,
                retryContext.segment.endMs,
              );
              if (signal.aborted) break;
              const repaired = await session.align({
                ...retryContext,
                pcm: retry.pcm,
              });
              if (signal.aborted) break;
              await onVerified(
                {
                  ...retryContext.segment,
                  lineIds: expanded.lineIds,
                  contextLineIds: [
                    ...new Set([
                      ...retryContext.segment.contextLineIds,
                      ...(repairPrevious ? [previous.id] : []),
                    ]),
                  ],
                },
                repaired.filter((l) => expanded.lineIds.includes(l.id)),
                repaired.filter((l) => !expanded.lineIds.includes(l.id)),
              );
            }
            states[segment.id] = "verified";
          } catch (error) {
            if (signal.aborted) break;
            states[segment.id] = "needs-review";
            onFailure(segment, error);
          }
        }
        if (Date.now() >= deadline) throw new Error("校時超過 10 分鐘");
        return states;
      } finally {
        signal.removeEventListener("abort", abort);
        session.release();
        running = false;
      }
    },
  };
}
