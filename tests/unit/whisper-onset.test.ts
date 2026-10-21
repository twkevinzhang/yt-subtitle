import { expect, it, vi } from "vitest";
import { WhisperAdapter } from "../../src/acoustic/whisper-adapter";
it("rechecks an unusually long first alignment over a real shorter audio crop and adopts only stronger acoustic evidence with the same ending", async () => {
  const adapter: any = new WhisperAdapter();
  const first = {
    id: "a",
    original: "actual sung phrase",
    excluded: false,
    status: "estimated",
    cueIds: [],
    startMs: 264260,
    endMs: 277180,
  };
  const next = { ...first, id: "b", startMs: 277860, endMs: 280760 };
  adapter.alignOnce = vi
    .fn()
    .mockResolvedValueOnce({
      lines: [first, next],
      scores: new Map([["a", -3.3]]),
    })
    .mockResolvedValueOnce({ lines: [], scores: new Map() })
    .mockResolvedValueOnce({
      lines: [{ ...first, startMs: 275100, endMs: 277100 }],
      scores: new Map([["a", -3.08]]),
    });
  const input = {
    verifyEvidence: true,
    pcm: new Float32Array(480000),
    lines: [{ ...first, startMs: undefined, endMs: undefined }, next],
    segment: {
      id: "s",
      lineIds: ["a", "b"],
      contextLineIds: [],
      startMs: 260900,
      endMs: 290900,
      language: "ja",
      occurrence: 1,
      evidenceCueIds: [],
    },
  };
  const result = await adapter.align(input);
  expect(result[0]).toMatchObject({ startMs: 275100, endMs: 277100 });
  expect(result[1]).toEqual(next);
  expect(adapter.alignOnce.mock.calls[2][0].pcm.length).toBe(6000 * 16);
  expect(adapter.alignOnce.mock.calls[2][0].segment).toMatchObject({
    startMs: 271180,
    endMs: 277180,
    lineIds: ["a"],
  });
});
it("keeps a long held opening word when the earlier real audio supports it", async () => {
  const adapter: any = new WhisperAdapter();
  const first = {
    id: "a",
    original: "forever waiting here",
    excluded: false,
    status: "estimated",
    cueIds: [],
    startMs: 1000,
    endMs: 14000,
  };
  adapter.alignOnce = vi
    .fn()
    .mockResolvedValueOnce({
      lines: [first, { ...first, id: "b", startMs: 14500, endMs: 16000 }],
      scores: new Map([["a", -3]]),
    })
    .mockResolvedValueOnce({
      lines: [{ ...first, original: "forever", startMs: 1000, endMs: 7000 }],
      scores: new Map([["a", -2]]),
    });
  const result = await adapter.align({
    verifyEvidence: true,
    pcm: new Float32Array(320000),
    lines: [{ ...first, startMs: undefined, endMs: undefined }],
    segment: {
      id: "s",
      lineIds: ["a", "b"],
      contextLineIds: [],
      startMs: 0,
      endMs: 20000,
      language: "en",
      occurrence: 1,
      evidenceCueIds: [],
    },
  });
  expect(result[0]).toEqual(first);
  expect(adapter.alignOnce).toHaveBeenCalledTimes(2);
  expect(adapter.alignOnce.mock.calls[1][0].lines[0].original).toBe("forever");
});
it("refines a line onset after a leading whitespace token instead of assigning the instrumental gap to the lyric", async () => {
  class Tensor {
    constructor(..._args: any[]) {}
    dispose() {}
  }
  const row = new Float32Array(1000).fill(0.001);
  for (let i = 700; i < 710; i++) row[i] = 1;
  const attention = { slice: () => ({ data: row, dispose() {} }) };
  const model: any = async () =>
    Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [`cross_attentions.${i}`, attention]),
    );
  model.generation_config = {
    lang_to_id: { "<|ja|>": 50266 },
    alignment_heads: [[0, 0]],
  };
  model._extract_token_timestamps = () => ({
    data: new Float32Array([0, 0, 0, 15, 16]),
    dispose() {},
  });
  const adapter: any = new WhisperAdapter();
  adapter.runtime = { Tensor };
  adapter.pipeline = {
    model,
    processor: async () => ({}),
    tokenizer: {
      encode: () => [0, 1, 2],
      decode: ([token]: number[]) => (token === 0 ? " " : "word"),
    },
  };
  const line = {
    id: "a",
    original: "actual sung phrase",
    excluded: false,
    status: "unaligned",
    cueIds: [],
  };
  const result = await adapter.align({
    pcm: new Float32Array(320000),
    lines: [line],
    segment: {
      id: "s",
      lineIds: ["a"],
      contextLineIds: [],
      startMs: 0,
      endMs: 20000,
      language: "ja",
      occurrence: 1,
      evidenceCueIds: [],
    },
  });
  expect(result[0].startMs).toBe(14000);
  expect(result[0].endMs).toBe(16000);
});
it("keeps DTW boundaries for later lines instead of shifting them to a later attention peak", async () => {
  class Tensor {
    constructor(..._args: any[]) {}
    dispose() {}
  }
  const row = new Float32Array(500).fill(0.001);
  for (let i = 140; i < 145; i++) row[i] = 1;
  const attention = { slice: () => ({ data: row, dispose() {} }) };
  const model: any = async () =>
    Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [`cross_attentions.${i}`, attention]),
    );
  model.generation_config = {
    lang_to_id: { "<|ja|>": 50266 },
    alignment_heads: [[0, 0]],
  };
  model._extract_token_timestamps = () => ({
    data: new Float32Array([0, 0, 0, 1, 2, 2, 3, 4]),
    dispose() {},
  });
  const adapter: any = new WhisperAdapter();
  adapter.runtime = { Tensor };
  adapter.pipeline = {
    model,
    processor: async () => ({}),
    tokenizer: {
      encode: () => [0, 1, 2],
      decode: ([token]: number[]) => (token === 0 ? " " : "word"),
    },
  };
  const lines = ["a", "b"].map((id) => ({
    id,
    original: "actual phrase",
    excluded: false,
    status: "unaligned",
    cueIds: [],
  }));
  const result = await adapter.align({
    pcm: new Float32Array(160000),
    lines,
    segment: {
      id: "s",
      lineIds: ["a", "b"],
      contextLineIds: [],
      startMs: 0,
      endMs: 10000,
      language: "ja",
      occurrence: 1,
      evidenceCueIds: [],
    },
  });
  expect(result[1].startMs).toBe(2000);
});
