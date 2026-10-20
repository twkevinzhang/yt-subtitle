import type {
  AcousticBackend,
  AcousticInput,
  RecognitionInput,
} from "./model-session";
import type { AlignedLine } from "../shared/types";
export class WorkerClient implements AcousticBackend {
  private worker: Worker;
  private sequence = 0;
  private waiting = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(progress: (file: string) => void = () => {}) {
    this.worker = new Worker(
      import.meta.url.replace(/[^/]+$/, "model-worker.js"),
      { type: "module" },
    );
    this.worker.onmessage = ({ data }) => {
      if (data.type === "download") {
        progress(data.file);
        return;
      }
      const pending = this.waiting.get(data.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.waiting.delete(data.id);
      if (data.error) pending.reject(new Error(data.error));
      else pending.resolve(data.lines);
    };
    this.worker.onerror = () => this.terminate();
  }
  private request(
    type: string,
    input?: AcousticInput | RecognitionInput,
  ): Promise<any> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.terminate();
        },
        type === "initialize" ? 120000 : 30000,
      );
      this.waiting.set(id, { resolve, reject, timer });
      try {
        this.worker.postMessage(
          {
            id,
            type,
            input: input ? { ...input, pcm: input.pcm.buffer } : undefined,
          },
          input ? [input.pcm.buffer as ArrayBuffer] : [],
        );
      } catch (e) {
        clearTimeout(timer);
        this.waiting.delete(id);
        reject(e);
      }
    });
  }
  async initialize() {
    await this.request("initialize");
  }
  align(input: AcousticInput): Promise<AlignedLine[]> {
    return this.request("align", input);
  }
  transcribe(input: RecognitionInput): Promise<string> {
    return this.request("transcribe", input);
  }
  async dispose() {
    await this.request("dispose");
  }
  terminate() {
    this.worker.terminate();
    for (const pending of this.waiting.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("聲學 Worker 已停止"));
    }
    this.waiting.clear();
  }
}
