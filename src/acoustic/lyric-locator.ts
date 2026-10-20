import type { SubtitleLine } from "../shared/types";
import type { Segment, TimeRange } from "./contracts";
import type { RangeAudioSource } from "./progressive-audio-source";
import type { RecognitionInput } from "./model-session";
import { transcriptCoverage } from "./missing-location";
const normalize = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
export const lyricLanguage = (text: string): "en" | "ja" | "zh" =>
  /[ぁ-ヿ]/u.test(text)
    ? "ja"
    : (text.match(/[a-z]/gi)?.length ?? 0) >
        (text.match(/\p{Script=Han}/gu)?.length ?? 0)
      ? "en"
      : "zh";
export interface LocationResult {
  contexts?: Record<string, { leadingText: string; trailingText: string }>;
  segments: Segment[];
  checked: TimeRange[];
  ambiguousLineIds: string[];
  silent: TimeRange[];
}
/** Match ordered whole passages; repeated text alone is insufficient evidence. */
export function matchLyricWindow(
  lines: SubtitleLine[],
  observed: string,
  range: TimeRange,
): LocationResult {
  const obs = normalize(observed),
    texts = lines.map((l) => normalize(l.alignmentText ?? l.original));
  const candidates: {
    from: number;
    to: number;
    text: string;
    score: number;
  }[] = [];
  for (let from = 0; from < lines.length; from++) {
    if (
      lines[from].excluded ||
      (lines[from].startMs !== undefined && lines[from].endMs !== undefined)
    )
      continue;
    let text = "";
    for (let to = from; to < Math.min(lines.length, from + 40); to++) {
      if (
        lines[to].excluded ||
        (lines[to].startMs !== undefined && lines[to].endMs !== undefined)
      )
        break;
      text += texts[to];
      if (text.length > 4000 || text.length > obs.length * 1.25) break;
      if (text.length < 2) continue;
      const coverage = transcriptCoverage(text, obs),
        precision = transcriptCoverage(obs, text);
      if (coverage >= 0.8 && precision >= 0.45)
        candidates.push({ from, to, text, score: coverage * precision });
    }
  }
  candidates.sort((a, b) => b.score - a.score || b.text.length - a.text.length);
  const best = candidates[0];
  const result: LocationResult = {
    segments: [],
    checked: [range],
    ambiguousLineIds: [],
    silent: [],
  };
  if (!best) {
    // A noisy passage need not invalidate a whole, uniquely recognized line.
    // Only exact, nontrivial anchors qualify here; neighbors receive no time.
    const anchors = texts.flatMap((text, index) => {
      const line = lines[index];
      const cjk = /[\p{Script=Han}ぁ-ヿ]/u.test(text);
      if (
        line.excluded ||
        (line.startMs !== undefined && line.endMs !== undefined) ||
        text.length < (cjk ? 6 : 24) ||
        (!cjk &&
          ((line.alignmentText ?? line.original).match(/\p{L}+/gu) ?? [])
            .length < 4) ||
        texts.filter((other) => other.includes(text)).length !== 1
      )
        return [];
      const at = obs.indexOf(text);
      if (at < 0 || obs.indexOf(text, at + 1) >= 0) return [];
      const before = [...lines.slice(0, index)]
        .reverse()
        .find((l) => l.endMs !== undefined);
      const after = lines.slice(index + 1).find((l) => l.startMs !== undefined);
      const startMs = Math.max(range.startMs, before?.endMs ?? 0);
      const endMs = Math.min(range.endMs, after?.startMs ?? Infinity);
      // Context was recognized from the entire lookup PCM. Keep that exact
      // window; neighboring source locks are enforced on the inferred result.
      return endMs > startMs ? [{ index, at, ...range }] : [];
    });
    if (anchors.some((a, i) => i > 0 && a.at <= anchors[i - 1].at))
      return result;
    const positions: number[] = [];
    let offset = 0;
    for (const char of observed) {
      for (let i = 0; i < normalize(char).length; i++) positions.push(offset);
      offset += char.length;
    }
    positions.push(observed.length);
    result.contexts = {};
    result.segments = anchors.map((a) => ({
      id: `anchor-${a.index}-${Math.round(a.startMs)}`,
      lineIds: [lines[a.index].id],
      contextLineIds: [],
      startMs: a.startMs,
      endMs: a.endMs,
      language: lyricLanguage(
        lines[a.index].alignmentText ?? lines[a.index].original,
      ),
      evidenceCueIds: [],
      occurrence: 1,
    }));
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      result.contexts[result.segments[i].id] = {
        leadingText: observed.slice(0, positions[a.at]),
        trailingText: observed.slice(positions[a.at + texts[a.index].length]),
      };
    }
    return result;
  }
  // Completed passages still explain speech heard inside this lookup window.
  // Removing them from competition can turn a later chorus into a false unique hit.
  for (let from = 0; from < lines.length; from++) {
    let text = "";
    for (let to = from; to < Math.min(lines.length, from + 40); to++) {
      const row = lines[to];
      if (
        row.excluded ||
        row.startMs === undefined ||
        row.endMs === undefined ||
        row.endMs <= range.startMs ||
        row.startMs >= range.endMs
      )
        break;
      text += texts[to];
      if (text.length > 4000 || text.length > obs.length * 1.25) break;
      const coverage = transcriptCoverage(text, obs),
        precision = transcriptCoverage(obs, text);
      if (
        coverage >= 0.8 &&
        precision >= 0.45 &&
        coverage * precision >= best.score - 0.08
      ) {
        result.ambiguousLineIds = lines
          .slice(best.from, best.to + 1)
          .map((l) => l.id);
        return result;
      }
    }
  }
  const alternatives = candidates.filter(
    (c) =>
      Math.abs(c.score - best.score) < 0.08 &&
      (c.to < best.from || c.from > best.to),
  );
  if (alternatives.length) {
    result.ambiguousLineIds = [
      ...new Set(
        [best, ...alternatives].flatMap((c) =>
          lines.slice(c.from, c.to + 1).map((l) => l.id),
        ),
      ),
    ];
    return result;
  }
  const before = [...lines.slice(0, best.from)]
      .reverse()
      .find((l) => l.endMs !== undefined),
    after = lines.slice(best.to + 1).find((l) => l.startMs !== undefined);
  const startMs = Math.max(range.startMs, before?.endMs ?? 0),
    endMs = Math.min(range.endMs, after?.startMs ?? Infinity);
  if (endMs <= startMs) return result;
  result.segments.push({
    id: `located-${best.from}-${Math.round(startMs)}`,
    lineIds: lines.slice(best.from, best.to + 1).map((l) => l.id),
    contextLineIds: [],
    startMs,
    endMs,
    language: lyricLanguage(
      lines
        .slice(best.from, best.to + 1)
        .map((l) => l.original)
        .join(" "),
    ),
    evidenceCueIds: [],
    occurrence: 1,
  });
  return result;
}
export async function locateLyrics(
  lines: SubtitleLine[],
  range: TimeRange,
  audio: RangeAudioSource,
  recognizer: { transcribe(input: RecognitionInput): Promise<string> },
  signal: AbortSignal,
): Promise<LocationResult> {
  await audio.ensure(range, signal);
  if (signal.aborted) throw new Error("工作已取消");
  range = audio.readableRange(range);
  const { pcm } = await audio.read(range.startMs, range.endMs);
  const generation = audio.generation;
  const rms = Math.sqrt(
    pcm.reduce((n, v) => n + v * v, 0) / Math.max(1, pcm.length),
  );
  let text = await recognizer.transcribe({ pcm, language: "auto" });
  if (signal.aborted) throw new Error("工作已取消");
  let result = matchLyricWindow(lines, text, range);
  // Music can make automatic language detection transcribe Japanese as repeated
  // English. Recheck once with a script hint, still recognizing audio alone.
  const language = lyricLanguage(
    lines
      .filter(
        (l) =>
          !l.excluded && (l.startMs === undefined || l.endMs === undefined),
      )
      .map((l) => l.alignmentText ?? l.original)
      .join(" "),
  );
  if (
    !result.segments.length &&
    !result.ambiguousLineIds.length &&
    language !== "en" &&
    (text.trim() || rms >= 0.003) &&
    generation === audio.generation
  ) {
    text = await recognizer.transcribe({ pcm, language });
    if (signal.aborted) throw new Error("工作已取消");
    result = matchLyricWindow(lines, text, range);
  }
  if (!text.trim() && rms < 0.003) result.silent.push(range);
  return result;
}
