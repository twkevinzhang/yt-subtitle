import { it, expect, vi } from "vitest";
import { WhisperAdapter } from "../../src/acoustic/whisper-adapter";
it("makes the pinned runtime English fallback explicit instead of pretending it detects language", async () => {
  const adapter = new WhisperAdapter();
  const pipeline = vi.fn(async () => ({ text: "recognized" }));
  (adapter as any).pipeline = pipeline;
  const pcm = new Float32Array(16);
  await adapter.transcribe({ pcm, language: "auto" });
  expect(pipeline).toHaveBeenCalledWith(
    pcm,
    expect.objectContaining({ language: "en", task: "transcribe" }),
  );
  await adapter.transcribe({ pcm, language: "ja" });
  expect(pipeline).toHaveBeenLastCalledWith(
    pcm,
    expect.objectContaining({ language: "ja" }),
  );
});
