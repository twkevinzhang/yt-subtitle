import { localInferenceSchema } from "../shared/schemas";
import type { AcousticInput, RecognitionInput } from "./model-session";
import type { JobKey } from "./contracts";
import type { AlignedLine } from "../shared/types";
interface Session {
  ensureReady(): Promise<void>;
  transcribe(input: RecognitionInput): Promise<string>;
  readings?(texts: string[]): Promise<string[]>;
  align(input: AcousticInput): Promise<AlignedLine[]>;
  cancel(): void;
}
export class LocalModelHost {
  private active?: { key: JobKey; promise: Promise<unknown> };
  constructor(
    private session: Session,
    private read: (id: string) => Promise<ArrayBuffer>,
  ) {}
  get key() {
    return this.active?.key;
  }
  async infer(raw: unknown): Promise<unknown> {
    if (this.active) throw new Error("已有模型工作正在處理");
    const input = localInferenceSchema.parse(raw);
    const promise = (async () => {
      if (input.operation === "prepare") {
        await this.session.ensureReady();
        return null;
      }
      if (input.operation === "readings") {
        if (!input.texts || !this.session.readings)
          throw new Error("缺少本機讀音轉換器或文字");
        return this.session.readings(input.texts);
      }
      if (!input.assetId) throw new Error("缺少音訊 asset");
      const pcm = new Float32Array(await this.read(input.assetId));
      if (
        !pcm.length ||
        pcm.length > 480000 ||
        pcm.some((v) => !Number.isFinite(v))
      )
        throw new Error("音訊片段必須在 30 秒以內");
      if (input.operation === "transcribe") {
        if (!input.language) throw new Error("缺少辨識語言");
        return this.session.transcribe({ pcm, language: input.language });
      }
      if (!input.segment || !input.lines) throw new Error("缺少逐句校時資料");
      return this.session.align({
        verifyEvidence: input.verifyEvidence,
        pcm,
        leadingText: input.leadingText,
        trailingText: input.trailingText,
        segment: input.segment,
        lines: input.lines,
      });
    })();
    this.active = { key: input.key, promise };
    try {
      return await promise;
    } finally {
      if (this.active?.promise === promise) this.active = undefined;
    }
  }
  async cancel(key: JobKey) {
    if (!this.active) return;
    if (
      this.active.key.runId !== key.runId ||
      this.active.key.tabId !== key.tabId ||
      this.active.key.videoId !== key.videoId
    )
      throw new Error("模型工作 owner 不符");
    this.session.cancel();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.active.promise.catch(() => {}),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("模型尚未停止")), 6500);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
