import type { AlignedLine, Cue } from "../shared/types";
import type { Segment } from "./contracts";
import type { AudioSource } from "./audio-source";
import type { RecognitionInput } from "./model-session";
import { transcriptCoverage } from "./missing-location";
const clean = (text: string) => text.replace(/\[[^\]]*\]/gu, " ").trim();
export async function prepareAcousticContext(
  owner: Segment,
  lines: AlignedLine[],
  segments: Segment[],
  cues: Cue[],
  audio: AudioSource,
  recognizer: { transcribe?(input: RecognitionInput): Promise<string> },
  signal: AbortSignal,
) {
  const range = audio
    .availableRanges()
    .find((r) => r.startMs <= owner.startMs && r.endMs >= owner.endMs);
  if (!range) throw new Error("尚未取得完整片段音訊");
  let startMs = Math.max(range.startMs, owner.startMs - 2000),
    endMs = Math.min(range.endMs, owner.endMs + 2000),
    leadingText: string | undefined;
  const contexts = new Set(owner.contextLineIds);
  const first = lines.findIndex((l) => l.id === owner.lineIds[0]),
    last = lines.findIndex((l) => l.id === owner.lineIds.at(-1));
  const previous = [...lines.slice(0, first)]
    .reverse()
    .find((l) => !l.excluded);
  const next = lines.slice(last + 1).find((l) => !l.excluded);
  const previousEnd =
    previous?.endMs ??
    segments.find((s) => previous && s.lineIds.includes(previous.id))?.endMs;
  const nextStart =
    next?.startMs ??
    segments.find((s) => next && s.lineIds.includes(next.id))?.startMs;
  if (
    previous &&
    previousEnd !== undefined &&
    owner.startMs - previousEnd < 6000
  ) {
    contexts.add(previous.id);
    startMs = Math.max(
      range.startMs,
      Math.min(
        startMs,
        previous.startMs !== undefined
          ? previous.startMs - 200
          : owner.startMs - 5000,
      ),
    );
  } else if (previous) {
    const cue = [...cues]
      .reverse()
      .find(
        (c) =>
          c.startMs < owner.startMs &&
          c.startMs >= owner.startMs - 6000 &&
          c.endMs >= owner.startMs - 6000 &&
          clean(c.text),
      );
    if (cue) {
      leadingText = clean(cue.text);
      startMs = Math.max(range.startMs, Math.min(startMs, cue.startMs));
    }
  } else if (
    recognizer.transcribe &&
    (owner.startMs === range.startMs ||
      owner.startMs - range.startMs >= 1500) &&
    owner.startMs - range.startMs <= 8000
  ) {
    const preludeStart = Math.max(range.startMs, owner.startMs - 5000),
      preludeEnd =
        owner.startMs === range.startMs
          ? Math.min(range.endMs, owner.startMs + 3000)
          : owner.startMs - 500;
    const { pcm } = await audio.read(preludeStart, preludeEnd);
    if (signal.aborted) throw new Error("校時已取消");
    const text = clean(
      await recognizer.transcribe({ pcm, language: owner.language }),
    );
    if (signal.aborted) throw new Error("校時已取消");
    if (
      text &&
      transcriptCoverage(
        lines[first].alignmentText ?? lines[first].original,
        text,
      ) < 0.35
    ) {
      leadingText = text;
      startMs = preludeStart;
    }
  }
  if (next && nextStart !== undefined && nextStart - owner.endMs < 6000) {
    contexts.add(next.id);
    endMs = Math.min(
      range.endMs,
      Math.max(
        endMs,
        next.endMs !== undefined ? next.endMs + 200 : owner.endMs + 5000,
      ),
    );
  }
  const left = owner.startMs - startMs,
    right = endMs - owner.endMs,
    allowance = 30000 - (owner.endMs - owner.startMs);
  if (left + right > allowance) {
    const scale = allowance / (left + right);
    startMs = owner.startMs - left * scale;
    endMs = owner.endMs + right * scale;
  }
  return {
    segment: {
      ...owner,
      startMs,
      endMs,
      contextLineIds: [...contexts].filter((id) => !owner.lineIds.includes(id)),
    },
    lines,
    leadingText,
  };
}
