import { MAX_AUDIO_BYTES } from "../acoustic/contracts";
type Upload = {
  tabId: number;
  videoId: string;
  expires: number;
  chunks: Uint8Array[];
  bytes: number;
  limit: number;
};
// Only compressed audio crosses runtime JSON, in small sequential chunks.
// PCM is decoded in the extension offscreen host and transferred to its worker.
export class AudioUploads {
  private uploads = new Map<string, Upload>();
  constructor(private now = Date.now) {}
  get isBusy() {
    for (const [id, owner] of this.uploads)
      if (owner.expires < this.now()) this.uploads.delete(id);
    return this.uploads.size > 0;
  }
  begin(tabId: number, videoId: string, limit = MAX_AUDIO_BYTES) {
    for (const [id, upload] of this.uploads)
      if (upload.expires < this.now()) this.uploads.delete(id);
    if (this.uploads.size) throw new Error("已有音訊正在傳送");
    const id = crypto.randomUUID();
    this.uploads.set(id, {
      tabId,
      videoId,
      expires: this.now() + 90000,
      chunks: [],
      bytes: 0,
      limit,
    });
    return id;
  }
  private get(id: string, tabId: number, videoId: string) {
    const upload = this.uploads.get(id);
    if (
      !upload ||
      upload.tabId !== tabId ||
      upload.videoId !== videoId ||
      upload.expires < this.now()
    )
      throw new Error("音訊工作已過期或不屬於此影片");
    return upload;
  }
  append(
    id: string,
    tabId: number,
    videoId: string,
    sequence: number,
    base64: string,
  ) {
    const upload = this.get(id, tabId, videoId);
    if (sequence !== upload.chunks.length || base64.length > 350000)
      throw new Error("音訊順序或區塊大小錯誤");
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    if (!bytes.length || upload.bytes + bytes.length > upload.limit)
      throw new Error("音訊超過 64 MiB 上限");
    upload.chunks.push(bytes);
    upload.bytes += bytes.length;
  }
  finish(id: string, tabId: number, videoId: string) {
    const upload = this.get(id, tabId, videoId);
    this.uploads.delete(id);
    if (!upload.bytes) throw new Error("音訊為空");
    const data = new Uint8Array(upload.bytes);
    let cursor = 0;
    for (const chunk of upload.chunks) {
      data.set(chunk, cursor);
      cursor += chunk.length;
    }
    return data.buffer;
  }
  clearTab(tabId: number) {
    for (const [id, upload] of this.uploads)
      if (upload.tabId === tabId) this.uploads.delete(id);
  }
}
export class AudioStaging {
  private assets = new Map<
    string,
    { tabId: number; videoId: string; ready: boolean; expires: number }
  >();
  constructor(
    private remove: (id: string) => Promise<unknown>,
    private now = Date.now,
  ) {}
  get isBusy() {
    return this.assets.size > 0;
  }
  async put(
    id: string,
    tabId: number,
    videoId: string,
    write: () => Promise<void>,
  ) {
    if (this.isBusy) throw new Error("已有音訊正在準備");
    const owner = {
      tabId,
      videoId,
      ready: false,
      expires: this.now() + 600000,
    };
    this.assets.set(id, owner);
    try {
      await write();
      if (this.assets.get(id) !== owner) throw new Error("音訊工作已取消");
      owner.ready = true;
    } catch (error) {
      if (this.assets.get(id) === owner) this.assets.delete(id);
      await this.remove(id);
      throw error;
    }
  }
  claim(id: string, tabId: number, videoId: string) {
    const owner = this.assets.get(id);
    if (
      !owner?.ready ||
      owner.tabId !== tabId ||
      owner.videoId !== videoId ||
      owner.expires < this.now()
    )
      throw new Error("音訊暫存已過期或不屬於此影片");
    this.assets.delete(id);
    return true;
  }
  async clearTab(tabId: number) {
    const ids: string[] = [];
    for (const [id, owner] of this.assets)
      if (owner.tabId === tabId) {
        this.assets.delete(id);
        ids.push(id);
      }
    await Promise.all(ids.map((id) => this.remove(id)));
  }
  async expire() {
    for (const [id, owner] of this.assets)
      if (owner.expires < this.now()) {
        this.assets.delete(id);
        await this.remove(id);
      }
  }
}
