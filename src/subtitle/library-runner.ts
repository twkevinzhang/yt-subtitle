import type {
  AudioInput,
  LyricAlignBinding,
  OperationContext,
} from "./library-contract";
import type { PreparedLyrics, ResultValidation } from "./types";
import { validateAligned } from "./result-validation";
export async function runUntimed(
  binding: LyricAlignBinding,
  audio: AudioInput,
  lyrics: PreparedLyrics,
  languageHint: string | undefined,
  context: OperationContext,
): Promise<ResultValidation> {
  context.signal.throwIfAborted();
  if (
    languageHint &&
    !binding.capabilities.supportedLanguages.includes(languageHint)
  )
    throw Object.assign(new Error("語音模型尚未支援這個語言"), {
      code: "UNSUPPORTED_LANGUAGE",
    });
  if (
    audio.sampleRate !== 16000 ||
    !audio.pcm.length ||
    audio.pcm.some((x) => !Number.isFinite(x))
  )
    throw Object.assign(new Error("音訊內容不合法"), { code: "INVALID_INPUT" });
  const session = await binding.createSession();
  try {
    context.signal.throwIfAborted();
    await session.prepare({ language: languageHint }, context);
    context.signal.throwIfAborted();
    const segments = await session.transcribe(
      audio,
      {
        language: languageHint,
        ...(binding.capabilities.lyricsContext
          ? { lyricsContext: lyrics.lyrics }
          : {}),
      },
      context,
    );
    context.signal.throwIfAborted();
    const aligned = await session.align(segments, lyrics.lyrics, {}, context);
    context.signal.throwIfAborted();
    return validateAligned(
      lyrics,
      aligned,
      audio.pcm.length / audio.sampleRate,
    );
  } finally {
    await session.dispose();
  }
}
