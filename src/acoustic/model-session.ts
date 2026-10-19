import type { AlignedLine } from "../shared/types";
import {
  IDLE_MS,
  SEGMENT_TIMEOUT_MS,
  CANCEL_GRACE_MS,
  type ModelState,
  type Segment,
} from "./contracts";
export interface AcousticInput {
  segment: Segment;
  lines: AlignedLine[];
  pcm: Float32Array;
}
export interface AcousticBackend {
  initialize(): Promise<void>;
  align(input: AcousticInput): Promise<AlignedLine[]>;
  dispose(): Promise<void>;
  terminate(): void;
}
export class ModelSession {
  state: ModelState = "unloaded";
  initializationCount = 0;
  private backend?: AcousticBackend;
  private loading?: Promise<void>;
  private disposing?: Promise<void>;
  private idle?: ReturnType<typeof setTimeout>;
  private cancelTimer?: ReturnType<typeof setTimeout>;
  private owners = 0;
  private active = false;
  private generation = 0;
  private pendingReject?: (e: Error) => void;
  private loadingReject?: (e: Error) => void;
  constructor(
    private create: () => AcousticBackend,
    private onIdle: () => void = () => {},
  ) {}
  retain() {
    clearTimeout(this.idle);
    this.owners++;
  }
  release() {
    this.owners = Math.max(0, this.owners - 1);
    this.scheduleIdle();
  }
  private scheduleIdle() {
    clearTimeout(this.idle);
    if (!this.owners && this.state === "ready")
      this.idle = setTimeout(() => {
        void this.dispose().then(this.onIdle, this.onIdle);
      }, IDLE_MS);
  }
  async ensureReady(): Promise<void> {
    clearTimeout(this.idle);
    if (this.disposing) await this.disposing;
    if (this.loading) return this.loading;
    if (this.backend && (this.state === "ready" || this.state === "busy"))
      return;
    this.state = "loading";
    this.initializationCount++;
    const backend = this.create(),
      generation = this.generation;
    this.backend = backend;
    this.loading = Promise.race([
      backend.initialize(),
      new Promise<never>((_, reject) => {
        this.loadingReject = reject;
      }),
    ])
      .then(() => {
        if (generation !== this.generation) throw new Error("模型載入已取消");
        this.state = "ready";
      })
      .catch((e) => {
        backend.terminate();
        if (this.backend === backend) {
          this.backend = undefined;
          this.state = "unloaded";
        }
        throw e;
      })
      .finally(() => {
        this.loadingReject = undefined;
        this.loading = undefined;
        this.scheduleIdle();
      });
    return this.loading;
  }
  async align(input: AcousticInput): Promise<AlignedLine[]> {
    if (this.active) throw new Error("已有片段正在校時");
    this.active = true;
    this.retain();
    try {
      await this.ensureReady();
      this.state = "busy";
      const backend = this.backend!;
      let timeout: ReturnType<typeof setTimeout>;
      try {
        return await Promise.race([
          backend.align(input),
          new Promise<never>((_, reject) => {
            this.pendingReject = reject;
            timeout = setTimeout(
              () => this.kill(new Error("片段校時超過 30 秒")),
              SEGMENT_TIMEOUT_MS,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout!);
        clearTimeout(this.cancelTimer);
        this.cancelTimer = undefined;
        this.pendingReject = undefined;
        if (this.backend === backend) this.state = "ready";
      }
    } finally {
      this.active = false;
      this.release();
    }
  }
  cancel() {
    if ((this.active || this.loading) && !this.cancelTimer)
      this.cancelTimer = setTimeout(
        () => this.kill(new Error("校時已取消")),
        CANCEL_GRACE_MS,
      );
  }
  private kill(error: Error) {
    this.generation++;
    this.backend?.terminate();
    this.backend = undefined;
    this.state = "unloaded";
    this.pendingReject?.(error);
    this.loadingReject?.(error);
    clearTimeout(this.cancelTimer);
    this.cancelTimer = undefined;
  }
  async dispose(): Promise<void> {
    clearTimeout(this.idle);
    if (this.disposing) return this.disposing;
    if (this.pendingReject) this.kill(new Error("模型已釋放"));
    if (this.loading) {
      this.kill(new Error("模型載入已取消"));
      try {
        await this.loading;
      } catch {
        /* cancelled */
      }
    }
    const backend = this.backend;
    this.backend = undefined;
    this.state = "disposal";
    this.disposing = (async () => {
      try {
        await backend?.dispose();
      } finally {
        backend?.terminate();
        this.state = "unloaded";
        this.disposing = undefined;
      }
    })();
    return this.disposing;
  }
}
