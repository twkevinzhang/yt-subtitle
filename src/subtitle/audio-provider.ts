export interface AudioHandle {
  id: string;
  sampleRate: 16000;
  sampleCount: number;
}
export interface AudioProvider {
  acquire(
    videoId: string,
    durationSeconds: number,
    signal: AbortSignal,
  ): Promise<AudioHandle>;
}
/** Existing PO token service provides tokens, not a complete independent audio download. */
export const audioProvider: AudioProvider = {
  async acquire(_videoId, _durationSeconds, signal) {
    signal.throwIfAborted();
    throw Object.assign(
      new Error("尚未接入獨立的整首音訊下載來源；影片播放不受影響。"),
      { code: "AUDIO_UNAVAILABLE" },
    );
  },
};
