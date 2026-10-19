import type { AlignedLine, Cue } from "../shared/types";
import type { Segment } from "./contracts";
import type { AudioSource } from "./audio-source";
import type { RecognitionInput } from "./model-session";

const normalize = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
export function transcriptCoverage(expected: string, observed: string) {
  const a = normalize(expected),
    b = normalize(observed);
  if (!a.length || !b.length || a.length > 4000 || b.length > 4000) return 0;
  const previous = new Uint16Array(b.length + 1);
  for (const letter of a) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j++) {
      const saved = previous[j];
      previous[j] =
        letter === b[j - 1]
          ? diagonal + 1
          : Math.max(previous[j], previous[j - 1]);
      diagonal = saved;
    }
  }
  return previous[b.length] / a.length;
}
export function hasAcousticEvidence(lines: string[], observed: string) {
  const coverage = transcriptCoverage(lines.join(" "), observed);
  if (coverage >= 0.8) return true;
  if (lines.length < 2 || coverage < 0.35) return false;
  const words = (value: string) =>
    value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\b[a-z]*\*+[a-z]*/giu, " ")
      .match(/\p{L}+/gu) ?? [];
  const transcript = words(observed);
  let cursor = 0,
    anchors = 0;
  for (const line of lines) {
    const prefix = words(line).slice(0, 4);
    if (
      prefix.length < 4 ||
      prefix.filter(
        (w) =>
          !["you", "i", "a", "the", "to", "in", "of", "that", "and"].includes(
            w,
          ),
      ).length < 2
    )
      continue;
    for (let start = cursor; start < transcript.length; start++) {
      let matched = 0;
      for (let j = start; j < Math.min(start + 5, transcript.length); j++)
        if (transcript[j] === prefix[matched]) matched++;
      if (matched === 4) {
        anchors++;
        cursor = start + 5;
        break;
      }
    }
  }
  return anchors >= Math.max(2, Math.ceil(lines.length / 2));
}

// Search only bounded caption music gaps between the nearest known owners.
// ASR sees audio alone; supplied lyrics are never used as a recognition prompt.
export async function locateMissing(
  lines: AlignedLine[],
  segments: Segment[],
  cues: Cue[],
  audio: AudioSource,
  recognizer: { transcribe(input: RecognitionInput): Promise<string> },
  signal: AbortSignal,
  diagnostic: (message: string) => void = () => {},
  bounds?: Record<string, { startMs: number; endMs: number }>,
): Promise<Segment[]> {
  const owner = new Map(
    segments.flatMap((s) => s.lineIds.map((id) => [id, s] as const)),
  );
  const groups: AlignedLine[][] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (owner.has(line.id) || line.excluded || line.status === "manual")
      continue;
    const group = [line];
    while (
      i + 1 < lines.length &&
      !owner.has(lines[i + 1].id) &&
      !lines[i + 1].excluded &&
      lines[i + 1].status !== "manual" &&
      (!bounds ||
        (bounds[lines[i + 1].id]?.startMs === bounds[line.id]?.startMs &&
          bounds[lines[i + 1].id]?.endMs === bounds[line.id]?.endMs))
    )
      group.push(lines[++i]);
    groups.push(group);
  }
  const music: { startMs: number; endMs: number; cueIds: string[] }[] = [];
  for (const cue of [...cues].sort((a, b) => a.startMs - b.startMs)) {
    if (!/^\s*(?:\[(?:音楽|歌声|music|applause)\]\s*)+$/iu.test(cue.text))
      continue;
    const previous = music.at(-1);
    if (
      previous &&
      cue.startMs <= previous.endMs + 100 &&
      cue.endMs - previous.startMs <= 26000
    ) {
      previous.endMs = Math.max(previous.endMs, cue.endMs);
      previous.cueIds.push(cue.id);
    } else
      music.push({ startMs: cue.startMs, endMs: cue.endMs, cueIds: [cue.id] });
  }
  const found: Segment[] = [];
  let attempts = 0;
  const recognized = new Map<string, string>();
  for (const group of groups) {
    const first = lines.indexOf(group[0]),
      last = lines.indexOf(group.at(-1)!);
    const before = [...lines.slice(0, first)]
      .reverse()
      .find((l) => owner.has(l.id));
    const after = lines.slice(last + 1).find((l) => owner.has(l.id));
    const lower = Math.max(
      before ? owner.get(before.id)!.endMs : 0,
      bounds?.[group[0].id]?.startMs ?? 0,
    );
    const upper = Math.min(
      bounds?.[group[0].id]?.endMs ?? Infinity,
      after
        ? owner.get(after.id)!.startMs
        : (audio.availableRanges().at(-1)?.endMs ?? 0),
    );
    if (upper <= lower) continue;
    const text = group.map((l) => l.alignmentText ?? l.original).join(" ");
    const latin = text.match(/[a-z]/giu)?.length ?? 0,
      cjk = text.match(/[ぁ-ヿ\p{Script=Han}]/gu)?.length ?? 0;
    const language = latin > cjk ? "en" : /[ぁ-ヿ]/u.test(text) ? "ja" : "zh";
    // A short gap bounded by actual neighboring owners is also searchable.
    // Garbled ASR text is not evidence that the supplied lyric was absent.
    const candidates = music.filter(
      (g) =>
        g.startMs >= lower && g.endMs <= upper && g.endMs - g.startMs >= 4000,
    );
    if (!candidates.length) {
      for (
        let startMs = lower;
        startMs < upper && candidates.length < 8;
        startMs += 24000
      ) {
        candidates.push({
          startMs,
          endMs: Math.min(upper, startMs + 26000),
          cueIds: [],
        });
      }
    }
    if (upper > lower && upper - lower <= 30000) {
      const cueIds = cues
        .filter((c) => c.endMs >= lower && c.startMs <= upper)
        .map((c) => c.id);
      if (cueIds.length)
        candidates.unshift({ startMs: lower, endMs: upper, cueIds });
    }
    for (const gap of candidates) {
      if (signal.aborted) throw new Error("校時已取消");
      if (
        gap.startMs < lower ||
        gap.endMs > upper ||
        gap.endMs - gap.startMs < 4000
      )
        continue;
      const startMs = Math.max(lower, gap.startMs - 2000),
        endMs = Math.min(upper, gap.endMs + 2000);
      if (
        endMs - startMs > 30000 ||
        !audio
          .availableRanges()
          .some((r) => r.startMs <= startMs && r.endMs >= endMs)
      )
        continue;
      const key = `${startMs}:${endMs}:${language}`;
      let transcript = recognized.get(key);
      if (transcript === undefined) {
        if (++attempts > 8) return found;
        const { pcm } = await audio.read(startMs, endMs);
        if (signal.aborted) throw new Error("校時已取消");
        transcript = await recognizer.transcribe({ pcm, language });
        if (signal.aborted) throw new Error("校時已取消");
        recognized.set(key, transcript);
      }
      const score = transcriptCoverage(text, transcript);
      diagnostic(
        JSON.stringify({
          startMs,
          endMs,
          language,
          score,
          text: transcript.slice(0, 1000),
        }),
      );
      if (
        !hasAcousticEvidence(
          group.map((l) => l.alignmentText ?? l.original),
          transcript,
        )
      )
        continue;
      const segment: Segment = {
        id: "asr-" + group[0].id,
        lineIds: group.map((l) => l.id),
        contextLineIds: [],
        startMs,
        endMs,
        language,
        evidenceCueIds: gap.cueIds,
        occurrence: 1,
      };
      found.push(segment);
      for (const line of group) owner.set(line.id, segment);
      break;
    }
  }
  return found;
}
