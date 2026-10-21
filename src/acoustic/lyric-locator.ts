import type { SubtitleLine } from "../shared/types";
import type { Segment, TimeRange } from "./contracts";
import type { RangeAudioSource } from "./progressive-audio-source";
import type { RecognitionInput } from "./model-session";
import { transcriptCoverage } from "./missing-location";
import type { TimingDiagnostics } from "./timing-diagnostics";
const normalize = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/gu, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[^\p{L}\p{N}]/gu, "");
/** Semi-global edit distance: arbitrary ASR context is free, lyric edits are not. */
function transcriptAnchors(
  text: string,
  observed: string,
  maxEdits = 0.25,
  minimumLength = 10,
) {
  if (!text.length || !observed.length) return [];
  const exact: { at: number; end: number }[] = [];
  for (
    let at = observed.indexOf(text);
    at >= 0;
    at = observed.indexOf(text, at + text.length)
  )
    exact.push({ at, end: at + text.length });
  if (exact.length) return exact;
  if (
    text.length < minimumLength ||
    text.length > 4000 ||
    observed.length > 4000
  )
    return [];
  let costs = new Uint16Array(observed.length + 1);
  let starts = Uint16Array.from({ length: observed.length + 1 }, (_, i) => i);
  for (let i = 1; i <= text.length; i++) {
    const next = new Uint16Array(observed.length + 1);
    const nextStarts = new Uint16Array(observed.length + 1);
    next[0] = i;
    for (let j = 1; j <= observed.length; j++) {
      const substitution =
        costs[j - 1] + (text[i - 1] === observed[j - 1] ? 0 : 1);
      const deletion = costs[j] + 1,
        insertion = next[j - 1] + 1;
      next[j] = Math.min(substitution, deletion, insertion);
      nextStarts[j] =
        next[j] === substitution
          ? starts[j - 1]
          : next[j] === deletion
            ? starts[j]
            : nextStarts[j - 1];
    }
    costs = next;
    starts = nextStarts;
  }
  const matches = Array.from(costs, (cost, end) => ({
    cost,
    at: starts[end],
    end,
  })).filter((m) => m.end > m.at && m.cost / text.length <= maxEdits);
  const hits: typeof matches = [];
  for (const match of matches) {
    const previous = hits.at(-1);
    if (!previous || match.at >= previous.end) hits.push(match);
    else if (match.cost < previous.cost) hits[hits.length - 1] = match;
  }
  return hits;
}
export const lyricLanguage = (text: string): "en" | "ja" | "zh" =>
  /[ぁ-ヿ]/u.test(text)
    ? "ja"
    : (text.match(/[a-z]/gi)?.length ?? 0) >
        (text.match(/\p{Script=Han}/gu)?.length ?? 0)
      ? "en"
      : "zh";
export interface LocationResult {
  recognitions?: { text: string; language: RecognitionInput["language"] }[];
  contexts?: Record<
    string,
    {
      leadingText: string;
      trailingText: string;
      alignmentLines?: SubtitleLine[];
    }
  >;
  fallbacks?: Record<string, Segment[]>;
  segments: Segment[];
  checked: TimeRange[];
  ambiguousLineIds: string[];
  silent: TimeRange[];
}
function windowEligibility(lines: SubtitleLine[], range: TimeRange) {
  return lines.map((line, index) => {
    const before = lines
      .slice(0, index)
      .reverse()
      .find((l) => !l.excluded && l.endMs !== undefined);
    const after = lines
      .slice(index + 1)
      .find((l) => !l.excluded && l.startMs !== undefined);
    return (
      (before?.endMs ?? 0) < range.endMs &&
      (after?.startMs ?? Infinity) > range.startMs &&
      (line.startMs ?? 0) < range.endMs &&
      (line.endMs ?? Infinity) > range.startMs
    );
  });
}
export function pendingLineIdsForWindow(
  lines: SubtitleLine[],
  range: TimeRange,
) {
  const possible = windowEligibility(lines, range);
  return lines.flatMap((line, index) =>
    possible[index] &&
    !line.excluded &&
    (line.startMs === undefined || line.endMs === undefined)
      ? [line.id]
      : [],
  );
}
/** Match ordered whole passages; repeated text alone is insufficient evidence. */
export function matchLyricWindow(
  lines: SubtitleLine[],
  observed: string,
  range: TimeRange,
  joint = false,
): LocationResult {
  const obs = normalize(observed),
    texts = lines.map((l) => normalize(l.alignmentText ?? l.original));
  // Source order plus existing endpoints rules out occurrences outside this
  // window. Text elsewhere in the song must not make a bounded repeat ambiguous.
  const possible = windowEligibility(lines, range);
  const pending = lines.flatMap((l, i) =>
    possible[i] &&
    !l.excluded &&
    (l.startMs === undefined || l.endMs === undefined)
      ? [i]
      : [],
  );
  const gapBefore = lines
    .slice(0, pending[0])
    .reverse()
    .find((l) => !l.excluded && l.endMs !== undefined);
  const gapAfter = lines
    .slice((pending.at(-1) ?? lines.length) + 1)
    .find((l) => !l.excluded && l.startMs !== undefined);
  const bounded =
    range.endMs - range.startMs <= 10000 &&
    gapBefore?.endMs === range.startMs &&
    gapAfter?.startMs === range.endMs;
  const anchorsFor = (text: string) =>
    transcriptAnchors(text, obs, bounded ? 0.4 : 0.25, bounded ? 6 : 10);
  const candidates: {
    from: number;
    to: number;
    text: string;
    score: number;
  }[] = [];
  for (let from = 0; from < lines.length; from++) {
    if (
      lines[from].excluded ||
      !possible[from] ||
      (lines[from].startMs !== undefined && lines[from].endMs !== undefined)
    )
      continue;
    let text = "";
    for (let to = from; to < Math.min(lines.length, from + 40); to++) {
      if (
        lines[to].excluded ||
        !possible[to] ||
        (lines[to].startMs !== undefined && lines[to].endMs !== undefined)
      )
        break;
      text += texts[to];
      if (
        text.length > 4000 ||
        text.length > obs.length * (bounded ? 1.75 : 1.25)
      )
        break;
      if (text.length < 2) continue;
      const coverage = transcriptCoverage(text, obs),
        precision = transcriptCoverage(obs, text);
      if (
        coverage >= (bounded ? 0.65 : 0.8) &&
        precision >= 0.45 &&
        texts.slice(from, to + 1).every((t) => anchorsFor(t).length > 0)
      )
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
  const findAnchors = () => {
    // A noisy passage need not invalidate a whole, uniquely recognized line.
    // Only exact, nontrivial anchors qualify here; neighbors receive no time.
    const anchors = texts.flatMap((text, index) => {
      const line = lines[index];
      const cjk = /[\p{Script=Han}ぁ-ヿ]/u.test(text);
      if (
        line.excluded ||
        !possible[index] ||
        (line.startMs !== undefined && line.endMs !== undefined) ||
        text.length < (cjk ? 6 : 24) ||
        (!cjk &&
          ((line.alignmentText ?? line.original).match(/\p{L}+/gu) ?? [])
            .length < 4)
      )
        return [];
      const occurrences = texts.flatMap((other, i) =>
        other.includes(text) &&
        possible[i] &&
        (lines[i].startMs === undefined ||
          lines[i].endMs === undefined ||
          (lines[i].startMs! < range.endMs && lines[i].endMs! > range.startMs))
          ? [i]
          : [],
      );
      const matches = anchorsFor(text);
      // Every possible occurrence must be accounted for. A single repeated
      // phrase still cannot identify which chorus was heard.
      if (matches.length !== occurrences.length) return [];
      const match = matches[occurrences.indexOf(index)];
      if (!match) return [];
      const before = [...lines.slice(0, index)]
        .reverse()
        .find((l) => l.endMs !== undefined);
      const after = lines.slice(index + 1).find((l) => l.startMs !== undefined);
      const startMs = Math.max(range.startMs, before?.endMs ?? 0);
      const endMs = Math.min(range.endMs, after?.startMs ?? Infinity);
      // Context was recognized from the entire lookup PCM. Keep that exact
      // window; neighboring source locks are enforced on the inferred result.
      return endMs > startMs ? [{ index, ...match, ...range }] : [];
    });
    if (
      anchors.some((a, i) => {
        if (!i) return false;
        const previous = anchors[i - 1];
        // Edit-distance spans can share a few characters at an ASR word boundary.
        // Source texts still go through one monotonic acoustic alignment; these
        // character positions never become timestamps.
        return (
          a.at <= previous.at ||
          a.end <= previous.end ||
          previous.end - a.at >
            Math.min(previous.end - previous.at, a.end - a.at) * 0.25
        );
      })
    )
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
        trailingText: observed.slice(positions[a.end]),
      };
    }
    if (joint && anchors.length > 1) {
      const singles = result.segments;
      const id = `joint-${singles[0].id}`;
      const inserts = new Map<string, SubtitleLine>();
      for (let i = 1; i < anchors.length; i++) {
        const text = observed.slice(
          positions[anchors[i - 1].end],
          positions[anchors[i].at],
        );
        if (!text.trim()) continue;
        let contextId = `__recognized-${id}-${i}`;
        while (lines.some((l) => l.id === contextId)) contextId += "_";
        inserts.set(lines[anchors[i].index].id, {
          id: contextId,
          original: text,
          excluded: false,
          status: "unaligned",
          cueIds: [],
          timing: {},
        });
      }
      result.contexts[id] = {
        leadingText: result.contexts[singles[0].id].leadingText,
        trailingText: result.contexts[singles.at(-1)!.id].trailingText,
        alignmentLines: lines.flatMap((l) =>
          inserts.has(l.id) ? [inserts.get(l.id)!, l] : [l],
        ),
      };
      result.segments = [
        {
          ...singles[0],
          id,
          lineIds: singles.flatMap((s) => s.lineIds),
          contextLineIds: [...inserts.values()].map((l) => l.id),
          language: lyricLanguage(
            anchors.map((a) => lines[a.index].original).join(" "),
          ),
        },
      ];
      result.fallbacks = { [id]: singles };
    }
    return result;
  };
  if (!best) return findAnchors();
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
        return findAnchors();
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
    return findAnchors();
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
function combineLocations(
  locations: LocationResult[],
  range: TimeRange,
): LocationResult {
  const result: LocationResult = {
    segments: [],
    contexts: {},
    fallbacks: {},
    checked: [range],
    silent: [],
    ambiguousLineIds: [],
  };
  const owned = new Set<string>();
  const entries = locations
    .flatMap((location) => [
      ...location.segments.map((segment) => ({ segment, location })),
      ...Object.values(location.fallbacks ?? {})
        .flat()
        .map((segment) => ({ segment, location })),
    ])
    .sort((a, b) => b.segment.lineIds.length - a.segment.lineIds.length);
  for (const { segment, location } of entries) {
    if (segment.lineIds.some((id) => owned.has(id))) continue;
    result.segments.push(segment);
    segment.lineIds.forEach((id) => owned.add(id));
    if (location.contexts?.[segment.id])
      result.contexts![segment.id] = location.contexts[segment.id];
    const fallbacks = location.fallbacks?.[segment.id];
    if (fallbacks) {
      result.fallbacks![segment.id] = fallbacks;
      for (const fallback of fallbacks)
        if (location.contexts?.[fallback.id])
          result.contexts![fallback.id] = location.contexts[fallback.id];
    }
  }
  result.ambiguousLineIds = [
    ...new Set(locations.flatMap((l) => l.ambiguousLineIds)),
  ].filter((id) => !owned.has(id));
  return result;
}
export async function locateLyrics(
  lines: SubtitleLine[],
  range: TimeRange,
  audio: RangeAudioSource,
  recognizer: {
    transcribe(input: RecognitionInput): Promise<string>;
    readings?(texts: string[]): Promise<string[]>;
  },
  signal: AbortSignal,
  cache?: {
    generation: number;
    recognitions: NonNullable<LocationResult["recognitions"]>;
  },
  diagnostics?: TimingDiagnostics,
): Promise<LocationResult> {
  await (diagnostics
    ? diagnostics.measureAsync(
        "audio-wait",
        () => audio.ensure(range, signal),
        range,
      )
    : audio.ensure(range, signal));
  if (signal.aborted) throw new Error("工作已取消");
  range = audio.readableRange(range);
  const read = () => audio.read(range.startMs, range.endMs);
  const { pcm } = await (diagnostics
    ? diagnostics.measureAsync("pcm-read", read, range)
    : read());
  const match = (rows: SubtitleLine[], text: string) =>
    diagnostics
      ? diagnostics.measure(
          "match",
          () => matchLyricWindow(rows, text, range, true),
          range,
        )
      : matchLyricWindow(rows, text, range, true);
  const generation = audio.generation;
  const rms = Math.sqrt(
    pcm.reduce((n, v) => n + v * v, 0) / Math.max(1, pcm.length),
  );
  const recognitions: NonNullable<LocationResult["recognitions"]> = [];
  const recognize = async (language: RecognitionInput["language"]) => {
    const cached =
      cache?.generation === generation
        ? cache.recognitions.find((r) => r.language === language)
        : undefined;
    diagnostics?.cache(cached !== undefined);
    const text =
      cached?.text ?? (await recognizer.transcribe({ pcm, language }));
    recognitions.push({ text, language });
    return text;
  };
  // In pinned Transformers.js 3.8.1, omitted language defaults to English;
  // automatic detection is a TODO. Choose from source text and time bounds.
  const hint = lyricLanguage(
    lines
      .filter((l) => !l.excluded)
      .map((l) => l.alignmentText ?? l.original)
      .join(" "),
  );
  const possible = windowEligibility(lines, range);
  const languages = [
    ...new Set(
      lines.flatMap((l, i) => {
        if (
          !possible[i] ||
          l.excluded ||
          (l.startMs !== undefined && l.endMs !== undefined)
        )
          return [];
        const language = lyricLanguage(l.alignmentText ?? l.original);
        return [
          language === "zh" && hint === "ja" ? ("ja" as const) : language,
        ];
      }),
    ),
  ].sort((a, b) => Number(b === hint) - Number(a === hint));
  const locations: LocationResult[] = [];
  for (const language of languages) {
    if (generation !== audio.generation) break;
    const text = await recognize(language);
    if (signal.aborted) throw new Error("工作已取消");
    locations.push(match(lines, text));
  }
  if (
    languages.includes("ja") &&
    recognizer.readings &&
    generation === audio.generation
  ) {
    const texts = [
      ...lines.map((l) => l.alignmentText ?? l.original),
      ...recognitions.map((r) => r.text),
    ];
    const pronounced: string[] = [];
    for (let offset = 0; offset < texts.length; offset += 128) {
      pronounced.push(
        ...(await recognizer.readings(texts.slice(offset, offset + 128))),
      );
      if (signal.aborted) throw new Error("工作已取消");
    }
    if (pronounced.length !== texts.length)
      throw new Error("本機讀音轉換缺少文字");
    const phoneticLines = lines.map((l, i) => ({
      ...l,
      alignmentText: pronounced[i],
    }));
    const originals = new Map(lines.map((l) => [l.id, l]));
    for (let i = 0; i < recognitions.length; i++) {
      const location = match(phoneticLines, pronounced[lines.length + i]);
      // Readings aid recognition; alignment keeps the supplied original text.
      for (const context of Object.values(location.contexts ?? {}))
        if (context.alignmentLines)
          context.alignmentLines = context.alignmentLines.map(
            (l) => originals.get(l.id) ?? l,
          );
      locations.push(location);
    }
  }
  const result = combineLocations(locations, range);
  const order = new Map(lines.map((line, index) => [line.id, index]));
  result.segments.sort(
    (a, b) => (order.get(a.lineIds[0]) ?? 0) - (order.get(b.lineIds[0]) ?? 0),
  );
  result.recognitions = recognitions;
  if (recognitions.every((r) => !r.text.trim()) && rms < 0.003)
    result.silent.push(range);
  return result;
}
