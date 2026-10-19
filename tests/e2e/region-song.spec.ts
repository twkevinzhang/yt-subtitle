import { test, expect, chromium } from "@playwright/test";
import {
  cp,
  readFile,
  mkdtemp,
  mkdir,
  writeFile,
  access,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseRegionPlan } from "../../src/lyrics/region-request";

test("real server region reply + real song WASM alignment (prepared audio, not acquisition E2E)", async () => {
  test.setTimeout(240000);
  const root = "artifacts/progressive-alignment";
  try {
    await access(root + "/real-region-reply.local.json");
    await access(root + "/real-region-input.local.json");
  } catch {
    test.skip(true, "No captured real region response/input; not a pass");
    return;
  }
  const source = JSON.parse(
    await readFile(root + "/real-region-input.local.json", "utf8"),
  );
  const raw = JSON.parse(
    await readFile(
      process.env.REGION_REPLY_PATH ?? root + "/real-region-reply.local.json",
      "utf8",
    ),
  );
  const plan = parseRegionPlan(raw, source.lines, source.cues, 299961);
  if (process.env.TEST_INTRO_ONLY === "1") {
    plan.lines = plan.lines.filter((l) => Number(l.id.slice(1)) <= 12);
    plan.segments = plan.segments.filter((s) => s.id === "s0");
  }
  if (process.env.TEST_BOUNDARY_ONLY === "1") {
    plan.lines = plan.lines.filter(
      (l) => Number(l.id.slice(1)) >= 48 && Number(l.id.slice(1)) <= 65,
    );
    plan.segments = plan.segments.filter((s) =>
      ["s7", "s8", "s9"].includes(s.id),
    );
  }
  if (process.env.TEST_ONSET_ONLY === "1") {
    const ids = [
      "l0",
      "l2",
      "l4",
      "l6",
      "l8",
      "l9",
      "l10",
      "l11",
      "l12",
      "l74",
      "l75",
      "l76",
      "l77",
    ];
    plan.lines = plan.lines.filter((l) => ids.includes(l.id));
    plan.segments = [
      ...plan.segments.slice(0, 2),
      {
        id: "known-tail",
        lineIds: ["l74", "l75", "l76", "l77"],
        contextLineIds: [],
        startMs: 210000,
        endMs: 226000,
        language: "en",
        evidenceCueIds: ["t31", "t32"],
        occurrence: 2,
      },
    ];
  }
  if (process.env.TEST_MISSING_ONLY === "1") {
    plan.lines = plan.lines.filter((l) =>
      ["l73", "l74", "l75", "l76", "l77"].includes(l.id),
    );
    plan.lines[0] = {
      ...plan.lines[0],
      startMs: 162480,
      endMs: 163260,
      status: "manual",
    };
    plan.segments = [
      {
        id: "known-anchor",
        lineIds: ["l73"],
        contextLineIds: [],
        startMs: 154500,
        endMs: 164500,
        language: "ja",
        evidenceCueIds: ["t22"],
        occurrence: 1,
      },
    ];
  }
  const report: any = {
    kind: "real server region reply + real song MV3 WASM; prepared audio",
    segments: plan.segments,
    jobs: [],
  };
  const folder = await mkdtemp(path.join(os.tmpdir(), "ai-lyrics-region-")),
    extension = path.join(folder, "extension");
  await cp("dist", extension, { recursive: true });
  await mkdir(path.join(extension, "models/onnx-community"), {
    recursive: true,
  });
  await cp(
    ".tools/browser-models/onnx-community/whisper-base_timestamped",
    path.join(extension, "models/onnx-community/whisper-base_timestamped"),
    { recursive: true },
  );
  const browser = await chromium.launchPersistentContext(
    path.join(folder, "profile"),
    {
      executablePath:
        "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
      headless: true,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    },
  );
  try {
    const worker =
      browser.serviceWorkers()[0] ??
      (await browser.waitForEvent("serviceworker"));
    await worker.evaluate(async () =>
      chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: "Real song acoustic integration validation",
      }),
    );
    const query = () =>
      worker.evaluate(() =>
        chrome.runtime.sendMessage({
          target: "acoustic-host",
          command: "query",
        }),
      );
    await query();
    const page = await browser.newPage();
    await page.goto(worker.url().replace("background.js", "options.html"));
    const audio = (await readFile("artifacts/suneo.m4a")).toString("base64");
    await page.evaluate(async (audio) => {
      const data = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("ai-lyrics-job-audio", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("audio");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("audio", "readwrite");
        tx.objectStore("audio").put(data.buffer, "song");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, audio);
    const started = Date.now();
    const reply = await worker.evaluate(
      (input) =>
        chrome.runtime.sendMessage({
          target: "acoustic-host",
          command: "start",
          input,
        }),
      {
        key: {
          runId: "real-region",
          tabId: 1,
          videoId: "e1ZMmRlsaaU",
          draftRevision: 1,
        },
        assetId: "song",
        lines: plan.lines,
        segments: plan.segments,
        cues: source.cues,
        positionMs: 0,
        encoding: "compressed",
        durationMs: 299961,
      },
    );
    expect(reply, JSON.stringify(reply)).toMatchObject({ ok: true });
    let result: any,
      previous = -1;
    const deadline = Date.now() + 180000;
    while (true) {
      result = await query();
      const snapshot = result.data?.snapshot;
      report.result = result.data;
      if (
        snapshot &&
        process.env.TEST_MISSING_ONLY !== "1" &&
        snapshot.lines.find((l: any) => l.id === "l8")?.startMs !== undefined
      ) {
        const introStart = snapshot.lines.find(
          (l: any) => l.id === "l0",
        )?.startMs;
        if (introStart !== undefined) {
          expect(introStart).toBeGreaterThan(2750);
          expect(
            introStart,
            "first sung word must not be clamped to the AI coarse start",
          ).toBeLessThan(3500);
        }
        expect(
          snapshot.lines.find((l: any) => l.id === "l8").startMs,
          "coarse caption padding must retain the early Japanese onset",
        ).toBeLessThan(19000);
        expect(
          snapshot.lines.find((l: any) => l.id === "l8").startMs,
        ).toBeGreaterThan(18000);
      }
      if (snapshot && snapshot.sequence !== previous) {
        previous = snapshot.sequence;
        report.jobs.push({
          elapsedMs: Date.now() - started,
          sequence: previous,
          timed: snapshot.lines.filter((l: any) => l.startMs !== undefined)
            .length,
        });
      }
      if (
        process.env.TEST_ONSET_ONLY === "1" &&
        snapshot?.lines.find((l: any) => l.id === "l0")?.startMs !== undefined
      ) {
        expect(
          snapshot.lines.find((l: any) => l.id === "l0").startMs,
        ).toBeGreaterThan(2750);
      }
      if (
        process.env.TEST_ONSET_ONLY === "1" &&
        snapshot?.lines.find((l: any) => l.id === "l74")?.startMs !== undefined
      ) {
        expect(
          snapshot.lines.find((l: any) => l.id === "l74").startMs,
        ).toBeGreaterThan(209700);
        expect(
          snapshot.lines.find((l: any) => l.id === "l74").startMs,
        ).toBeLessThan(210700);
      }
      if (result.data?.phase !== "running") break;
      if (Date.now() > deadline)
        throw new Error("Real song validation timeout");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    report.result = result.data;
    expect(result.data.phase, JSON.stringify(result)).toBe("complete");
    expect(
      result.data.snapshot.lines.every(
        (l: any) => l.excluded || l.endMs > l.startMs,
      ),
    ).toBe(true);
    expect(result.data.initializationCount).toBe(1);
    report.passed = true;
    await worker.evaluate(() =>
      chrome.runtime.sendMessage({
        target: "acoustic-host",
        command: "dispose",
      }),
    );
    await worker.evaluate(() => chrome.offscreen.closeDocument());
  } finally {
    await browser.close();
    await writeFile(
      root +
        (process.env.TEST_ONSET_ONLY === "1"
          ? "/onset-region-acoustic.json"
          : process.env.TEST_MISSING_ONLY === "1"
            ? "/missing-region-acoustic.json"
            : "/real-region-acoustic.json"),
      JSON.stringify(report, null, 2),
    );
    const cleanupTarget = path.resolve(folder);
    if (
      path.dirname(cleanupTarget) !== path.resolve(os.tmpdir()) ||
      !path.basename(cleanupTarget).startsWith("ai-lyrics-region-")
    )
      throw new Error("Unsafe test cleanup target");
    await rm(cleanupTarget, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
});
