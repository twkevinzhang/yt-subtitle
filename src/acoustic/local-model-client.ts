import { request } from "../shared/messages";
import type { JobKey } from "./contracts";
import type { AcousticInput, RecognitionInput } from "./model-session";
import type { AlignedLine } from "../shared/types";
export function createLocalModelClient(key: JobKey, signal: AbortSignal) {
  const check = () => {
    if (signal.aborted) throw new Error("工作已取消");
  };
  async function upload(pcm: Float32Array) {
    check();
    const id = await request<string>({ type: "audio-begin" });
    const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    for (
      let offset = 0, sequence = 0;
      offset < bytes.length;
      offset += 192 * 1024, sequence++
    ) {
      check();
      let binary = "";
      for (const value of bytes.subarray(offset, offset + 192 * 1024))
        binary += String.fromCharCode(value);
      await request({
        type: "audio-chunk",
        assetId: id,
        sequence,
        base64: btoa(binary),
      });
    }
    check();
    await request({ type: "audio-finish", assetId: id });
    check();
    return id;
  }
  return {
    async prepare() {
      check();
      await request({
        type: "local-model",
        input: { key, operation: "prepare" },
      });
      check();
    },
    async transcribe(input: RecognitionInput) {
      const assetId = await upload(input.pcm);
      const result = await request<string>({
        type: "local-model",
        input: {
          key,
          operation: "transcribe",
          assetId,
          language: input.language,
        },
      });
      check();
      return result;
    },
    async readings(texts: string[]) {
      check();
      const result = await request<string[]>({
        type: "local-model",
        input: { key, operation: "readings", texts },
      });
      check();
      return result;
    },
    async align(input: AcousticInput) {
      const assetId = await upload(input.pcm);
      const result = await request<AlignedLine[]>({
        type: "local-model",
        input: {
          key,
          operation: "align",
          verifyEvidence: input.verifyEvidence,
          leadingText: input.leadingText,
          trailingText: input.trailingText,
          assetId,
          segment: input.segment,
          lines: input.lines,
        },
      });
      check();
      return result;
    },
    async cancel() {
      await request({ type: "local-model-cancel", key });
    },
    verify(input: AcousticInput) {
      return this.align({ ...input, verifyEvidence: true });
    },
  };
}
