import { afterEach, expect, it, vi } from "vitest";
import {
  ModelSession,
  type AcousticBackend,
} from "../../src/acoustic/model-session";
afterEach(() => vi.useRealTimers());
function fixture() {
  const backend: AcousticBackend = {
    initialize: vi.fn(async () => {}),
    align: vi.fn(async () => []),
    dispose: vi.fn(async () => {}),
    terminate: vi.fn(),
  };
  return { backend, session: new ModelSession(() => backend) };
}
it("shares initialization and reuses a session across jobs", async () => {
  const { backend, session } = fixture();
  await Promise.all([session.ensureReady(), session.ensureReady()]);
  await session.ensureReady();
  expect(backend.initialize).toHaveBeenCalledTimes(1);
  await session.dispose();
});
it("does not dispose while a job owns it, releases after five minutes", async () => {
  vi.useFakeTimers();
  const { backend, session } = fixture();
  session.retain();
  await session.ensureReady();
  await vi.advanceTimersByTimeAsync(300001);
  expect(backend.dispose).not.toHaveBeenCalled();
  session.release();
  await vi.advanceTimersByTimeAsync(300000);
  expect(backend.dispose).toHaveBeenCalledTimes(1);
  expect(session.state).toBe("unloaded");
});
it("reinitializes after a failed load", async () => {
  const { backend, session } = fixture();
  vi.mocked(backend.initialize).mockRejectedValueOnce(new Error("load failed"));
  await expect(session.ensureReady()).rejects.toThrow("load failed");
  await session.ensureReady();
  expect(backend.initialize).toHaveBeenCalledTimes(2);
  await session.dispose();
});
it("terminates a hung call five seconds after cancellation", async () => {
  vi.useFakeTimers();
  const { backend, session } = fixture();
  vi.mocked(backend.align).mockImplementation(() => new Promise(() => {}));
  const pending = session.align({} as any).catch((e) => e);
  await vi.advanceTimersByTimeAsync(0);
  session.cancel();
  await vi.advanceTimersByTimeAsync(5000);
  expect(backend.terminate).toHaveBeenCalled();
  expect((await pending).message).toMatch(/取消/);
  expect(session.state).toBe("unloaded");
});
it("rejects overlapping align calls even during initialization", async () => {
  const { backend, session } = fixture();
  let ready!: () => void;
  vi.mocked(backend.initialize).mockImplementation(
    () =>
      new Promise((resolve) => {
        ready = resolve;
      }),
  );
  const first = session.align({} as any);
  await expect(session.align({} as any)).rejects.toThrow("已有片段");
  ready();
  await first;
  await session.dispose();
});
it("cancels a stalled initialization with the same five second grace", async () => {
  vi.useFakeTimers();
  const { backend, session } = fixture();
  vi.mocked(backend.initialize).mockImplementation(() => new Promise(() => {}));
  let settled = false;
  const pending = session.align({} as any).catch((e) => {
    settled = true;
    return e;
  });
  session.cancel();
  await vi.advanceTimersByTimeAsync(5000);
  expect(settled).toBe(true);
  expect((await pending).message).toMatch(/取消/);
});
it("keeps cancellation grace effective after an earlier graceful cancellation", async () => {
  vi.useFakeTimers();
  const { backend, session } = fixture();
  let finish!: () => void;
  vi.mocked(backend.align).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve([]);
      }),
  );
  const first = session.align({} as any);
  await vi.advanceTimersByTimeAsync(0);
  session.cancel();
  finish();
  await first;
  vi.mocked(backend.align).mockImplementationOnce(() => new Promise(() => {}));
  const second = session.align({} as any).catch((e) => e);
  await vi.advanceTimersByTimeAsync(0);
  session.cancel();
  await vi.advanceTimersByTimeAsync(5000);
  expect(backend.terminate).toHaveBeenCalled();
  expect((await second).message).toMatch(/取消/);
});
