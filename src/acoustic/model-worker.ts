import { WhisperAdapter } from "./whisper-adapter";
const adapter = new WhisperAdapter();
let busy = false;
globalThis.onmessage = async ({ data }) => {
  if (busy) {
    postMessage({ id: data.id, error: "模型正忙碌" });
    return;
  }
  busy = true;
  try {
    if (data.type === "initialize")
      await adapter.initialize((file) =>
        postMessage({ type: "download", file }),
      );
    else if (data.type === "align") {
      const lines = await adapter.align({
        ...data.input,
        pcm: new Float32Array(data.input.pcm),
      });
      postMessage({ id: data.id, lines });
      return;
    } else if (data.type === "transcribe") {
      const text = await adapter.transcribe({
        ...data.input,
        pcm: new Float32Array(data.input.pcm),
      });
      postMessage({ id: data.id, lines: text });
      return;
    } else if (data.type === "dispose") await adapter.dispose();
    else throw new Error("未知模型操作");
    postMessage({ id: data.id });
  } catch (e) {
    postMessage({
      id: data.id,
      error: e instanceof Error ? e.message : String(e),
    });
  } finally {
    busy = false;
  }
};
