import type {
  AudioInput,
  OperationContext,
  Progress,
} from "./library-contract";
import type { PreparedLyrics, ResultValidation } from "./types";
import { validateAligned } from "./result-validation";

/** The subset of lyric-align-ts `createAligner()` this extension relies on. */
export interface AlignerProgress {
  stage: string;
  completed?: number;
  total?: number;
}
export interface AlignerCue {
  start: number | null;
  end: number | null;
  matched: boolean;
}
export interface Aligner {
  align(input: {
    audio: { samples: Float32Array; sampleRate: 16000 };
    lyrics: string[];
    language: string;
    signal?: AbortSignal;
    onProgress?: (progress: AlignerProgress) => void;
  }): Promise<{ cues: readonly AlignerCue[] }>;
  dispose(): void;
}
export type CreateAligner = (options: {
  signal?: AbortSignal;
  onProgress?: (progress: AlignerProgress) => void;
}) => Promise<Aligner>;

const SUPPORTED_LANGUAGES = ["en", "ja", "zh"];

export async function runUntimed(
  createAligner: CreateAligner,
  audio: AudioInput,
  lyrics: PreparedLyrics,
  languageHint: string | undefined,
  context: OperationContext,
): Promise<ResultValidation> {
  context.signal.throwIfAborted();
  if (languageHint && !SUPPORTED_LANGUAGES.includes(languageHint))
    throw Object.assign(new Error("語音模型尚未支援這個語言"), {
      code: "UNSUPPORTED_LANGUAGE",
    });
  if (
    audio.sampleRate !== 16000 ||
    !audio.pcm.length ||
    audio.pcm.some((x) => !Number.isFinite(x))
  )
    throw Object.assign(new Error("音訊內容不合法"), { code: "INVALID_INPUT" });
  let sequence = 0;
  const report = (phase: Progress["phase"], event?: AlignerProgress) => {
    const measured =
      event &&
      Number.isFinite(event.completed) &&
      Number.isFinite(event.total) &&
      event.total! > 0 &&
      event.completed! >= 0 &&
      event.completed! <= event.total!;
    const base = {
      phase,
      sequence: ++sequence,
      ...(event?.stage ? { detail: event.stage } : {}),
    };
    context.onProgress?.(
      measured
        ? {
            ...base,
            kind: "measured",
            completed: event.completed!,
            total: event.total!,
            unit: "items",
            scope: event.stage,
          }
        : { ...base, kind: "indeterminate" },
    );
  };
  report("preparing-model");
  const aligner = await createAligner({
    signal: context.signal,
    onProgress: (event) => report("preparing-model", event),
  });
  try {
    context.signal.throwIfAborted();
    report("aligning");
    const result = await aligner.align({
      audio: { samples: audio.pcm, sampleRate: 16000 },
      lyrics: [...lyrics.lyrics],
      language: languageHint ?? "en",
      signal: context.signal,
      onProgress: (event) => report("aligning", event),
    });
    context.signal.throwIfAborted();
    if (result.cues.length !== lyrics.lyrics.length)
      throw Object.assign(new Error("對齊結果的句數與歌詞不一致"), {
        code: "CONTRACT_VIOLATION",
      });
    return validateAligned(
      lyrics,
      lyrics.lyrics.map((line, index) => {
        const cue = result.cues[index]!;
        return {
          line,
          start: cue.start,
          end: cue.end,
          matched: cue.matched,
          score: cue.matched ? 1 : 0,
        };
      }),
      audio.pcm.length / audio.sampleRate,
    );
  } finally {
    aligner.dispose();
  }
}
