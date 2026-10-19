import type { AlignedLine } from "../shared/types";
import type { AudioSource } from "./audio-source";
import type { AcousticInput } from "./model-session";
import {
  assertSegmentLines,
  type Segment,
  type SegmentState,
} from "./contracts";
interface Session {
  retain(): void;
  release(): void;
  cancel(): void;
  align(input: AcousticInput): Promise<AlignedLine[]>;
}
export function createScheduler(
  segments: Segment[],
  lines: AlignedLine[],
  audio: AudioSource,
  session: Session,
  onVerified: (segment: Segment, lines: AlignedLine[]) => Promise<void>,
  onFailure: (segment: Segment, error: unknown) => void = () => {},
) {
  const owners = new Set<string>(),
    ids = new Set<string>();
  for (const segment of segments) {
    assertSegmentLines(
      segment,
      lines.map((l) => l.id),
    );
    if (ids.has(segment.id)) throw new Error("片段 ID 重複");
    ids.add(segment.id);
    for (const id of segment.lineIds) {
      if (owners.has(id)) throw new Error("歌詞有多個 owner");
      owners.add(id);
    }
  }
  let position = 0,
    running = false;
  return {
    updatePosition(ms: number) {
      if (Number.isFinite(ms) && ms >= 0) position = ms;
    },
    async run(signal: AbortSignal) {
      if (running) throw new Error("排程已執行");
      running = true;
      const states: Record<string, SegmentState> = Object.fromEntries(
        segments.map((s) => [s.id, "pending"]),
      );
      const abort = () => session.cancel();
      signal.addEventListener("abort", abort);
      session.retain();
      const deadline = Date.now() + 600000;
      try {
        while (!signal.aborted && Date.now() < deadline) {
          const pending = segments.filter((s) => states[s.id] === "pending");
          if (!pending.length) break;
          const priority = (s: Segment) =>
            s.startMs <= position && position < s.endMs
              ? 0
              : s.startMs >= position
                ? 1
                : 2;
          pending.sort(
            (a, b) => priority(a) - priority(b) || a.startMs - b.startMs,
          );
          const segment = pending[0];
          if (
            !audio
              .availableRanges()
              .some(
                (r) => r.startMs <= segment.startMs && r.endMs >= segment.endMs,
              )
          ) {
            states[segment.id] = "waiting-audio";
            continue;
          }
          states[segment.id] = "running";
          try {
            const { pcm } = await audio.read(segment.startMs, segment.endMs);
            const result = await session.align({ segment, lines, pcm });
            if (signal.aborted) break;
            await onVerified(segment, result);
            states[segment.id] = "verified";
          } catch (error) {
            if (signal.aborted) break;
            states[segment.id] = "needs-review";
            onFailure(segment, error);
          }
        }
        if (Date.now() >= deadline) throw new Error("校時超過 10 分鐘");
        return states;
      } finally {
        signal.removeEventListener("abort", abort);
        session.release();
        running = false;
      }
    },
  };
}
