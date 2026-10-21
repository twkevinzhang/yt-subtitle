import type { AcousticInput, RecognitionInput } from "./model-session";
import type { AlignedLine } from "../shared/types";
import {
  segmentSchema,
  assertSegmentLines,
  MODEL_ID,
  MODEL_REVISION,
} from "./contracts";
import { prepareModelAssets } from "./model-assets";
import { refineTokenOnset } from "./token-onset";
import { JapaneseReadings } from "./japanese-readings";
import { tokenLogProbability, supportsAcousticText } from "./acoustic-evidence";
// Transformers.js' timestamp extraction is an internal API: pinned and isolated here.
// Avoid importing the package-wide declarations: 3.8.1 includes unrelated
// Float16Array/processor declarations incompatible with this project's TS lib.
interface Runtime {
  env: any;
  pipeline: (...args: any[]) => Promise<any>;
  Tensor: new (...args: any[]) => any;
}
export class WhisperAdapter {
  private pronunciation = new JapaneseReadings();
  readings(texts: string[]) {
    return this.pronunciation.convert(texts);
  }
  private runtime?: Runtime;
  private pipeline: any;
  async initialize(progress: (file: string) => void) {
    const moduleUrl = new URL("../vendor/transformers.min.js", import.meta.url)
      .href;
    this.runtime = await import(/* @vite-ignore */ moduleUrl);
    const { env, pipeline } = this.runtime!;
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.useBrowserCache = false;
    env.useFSCache = false;
    env.useCustomCache = true;
    env.customCache = (await prepareModelAssets(progress)) as any;
    env.backends.onnx.wasm!.wasmPaths = new URL(
      "../vendor/",
      import.meta.url,
    ).href;
    env.backends.onnx.wasm!.numThreads = 1;
    this.pipeline = await pipeline("automatic-speech-recognition", MODEL_ID, {
      revision: MODEL_REVISION,
      device: "wasm",
      dtype: "q8",
    });
  }
  async align(input: AcousticInput): Promise<AlignedLine[]> {
    const result = await this.alignOnce(input);
    const first = result.lines[0];
    // DTW can attach a long instrumental introduction to the first supplied
    // token. Compare one real shorter crop before publishing such an estimate.
    // The incoming text/times remain untouched; no time is interpolated.
    if (
      input.verifyEvidence &&
      first &&
      result.lines.length > 1 &&
      !input.leadingText &&
      !input.segment.contextLineIds.length &&
      first.endMs! - first.startMs! > 10000 &&
      input.lines.find((l) => l.id === first.id)?.startMs === undefined
    ) {
      const endMs = first.endMs!;
      const startMs = Math.max(input.segment.startMs, endMs - 6000);
      const from =
        Math.round(startMs * 16) - Math.round(input.segment.startMs * 16);
      const to =
        Math.round(endMs * 16) - Math.round(input.segment.startMs * 16);
      const words = (
        input.lines.find((l) => l.id === first.id)?.alignmentText ??
        first.original
      )
        .trim()
        .split(/\s+/u);
      const prefix = words[0];
      if (words.length < 2 || (prefix.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 4)
        return result.lines;
      const earlier = await this.alignOnce({
        ...input,
        leadingText: undefined,
        trailingText: undefined,
        pcm: input.pcm.slice(0, from),
        lines: [
          {
            ...first,
            original: prefix,
            alignmentText: undefined,
            startMs: undefined,
            endMs: undefined,
            status: "unaligned",
          },
        ],
        segment: {
          ...input.segment,
          id: input.segment.id + "-opening-check",
          lineIds: [first.id],
          contextLineIds: [],
          endMs: startMs,
        },
      });
      // A held opening word is real vocal content, even if a shorter crop has
      // a better decoder score. Never remove supported opening audio.
      if (earlier.lines.length) return result.lines;
      const focused = await this.alignOnce({
        ...input,
        leadingText: undefined,
        trailingText: undefined,
        pcm: input.pcm.slice(from, to),
        segment: {
          ...input.segment,
          id: input.segment.id + "-onset",
          lineIds: [first.id],
          contextLineIds: [],
          startMs,
          endMs,
        },
      });
      const refined = focused.lines.find((l) => l.id === first.id);
      if (
        refined &&
        focused.scores.get(first.id)! > result.scores.get(first.id)! &&
        refined.startMs! > first.startMs! &&
        Math.abs(refined.endMs! - endMs) <= 250
      )
        result.lines[0] = refined;
    }
    return result.lines;
  }
  private async alignOnce({
    verifyEvidence,
    segment,
    lines,
    pcm,
    leadingText,
    trailingText,
  }: AcousticInput): Promise<{
    lines: AlignedLine[];
    scores: Map<string, number>;
  }> {
    segmentSchema.parse(segment);
    assertSegmentLines(
      segment,
      lines.map((l) => l.id),
    );
    if (
      pcm.length !==
        Math.round(segment.endMs * 16) - Math.round(segment.startMs * 16) ||
      pcm.some((v) => !Number.isFinite(v))
    )
      throw new Error("音訊片段長度或內容不合法");
    if (!this.pipeline || !this.runtime) throw new Error("模型尚未就緒");
    const included = new Set([...segment.lineIds, ...segment.contextLineIds]);
    const selected = lines.filter((l) => included.has(l.id));
    if (leadingText?.trim())
      selected.unshift({
        id: "__audio-context",
        original: leadingText,
        cueIds: [],
        status: "unaligned",
        excluded: false,
      });
    if (trailingText?.trim())
      selected.push({
        id: "__audio-context-end",
        original: trailingText,
        cueIds: [],
        status: "unaligned",
        excluded: false,
      });
    const { Tensor } = this.runtime,
      transcriber = this.pipeline;
    const pieces = selected.map((l) =>
      transcriber.tokenizer.encode(" " + (l.alignmentText ?? l.original), {
        add_special_tokens: false,
      }),
    );
    const tokens: number[] = pieces.flat();
    if (!tokens.length || tokens.length > 400)
      throw new Error("片段歌詞 token 數不合法");
    const prefix = [
      50258,
      transcriber.model.generation_config.lang_to_id[`<|${segment.language}|>`],
      50359,
      50363,
    ];
    const decoder = new Tensor(
      "int64",
      BigInt64Array.from([...prefix, ...tokens], BigInt),
      [1, prefix.length + tokens.length],
    );
    const inputs = await transcriber.processor(pcm);
    let output: any, timestamps: any;
    try {
      const punctuation = /^[\s.,!?。、！？「」『』…=＝”"’'()（）]+$/u;
      const scores = (logits: any) => {
        const vocabulary = logits.dims.at(-1);
        let cursor = 0;
        return pieces.map((piece: number[]) => {
          let total = 0,
            a = 0,
            b = piece.length;
          while (
            a < b &&
            punctuation.test(transcriber.tokenizer.decode([piece[a]]))
          )
            a++;
          while (
            b > a &&
            punctuation.test(transcriber.tokenizer.decode([piece[b - 1]]))
          )
            b--;
          for (let i = a; i < b; i++)
            total += tokenLogProbability(
              logits.data,
              prefix.length - 1 + cursor + i,
              vocabulary,
              piece[i],
            );
          cursor += piece.length;
          return b > a ? total / (b - a) : -Infinity;
        });
      };
      let silentScores: number[] | undefined;
      if (verifyEvidence) {
        const silentInputs = await transcriber.processor(
          new Float32Array(pcm.length),
        );
        let control: any;
        try {
          control = await transcriber.model({
            ...silentInputs,
            decoder_input_ids: decoder,
          });
          silentScores = scores(control.logits);
        } finally {
          for (const t of Object.values(silentInputs)) (t as any)?.dispose?.();
          for (const t of Object.values(control ?? {})) (t as any)?.dispose?.();
        }
      }
      output = await transcriber.model({
        ...inputs,
        decoder_input_ids: decoder,
      });
      const actualScores = verifyEvidence ? scores(output.logits) : undefined;
      const frames = Math.floor(pcm.length / 320);
      const attention = Array.from({ length: 6 }, (_, i) =>
        output[`cross_attentions.${i}`].slice(
          null,
          null,
          [prefix.length - 1, null],
          [0, frames],
        ),
      );
      const sequences = new Tensor(
        "int64",
        new BigInt64Array(tokens.length + 2),
        [1, tokens.length + 2],
      );
      try {
        timestamps = transcriber.model._extract_token_timestamps(
          { cross_attentions: [attention], sequences },
          transcriber.model.generation_config.alignment_heads,
          frames,
        );
      } finally {
        sequences.dispose();
        for (const t of attention) t.dispose?.();
      }
      const times = Array.from(timestamps.data as Float32Array).slice(1);
      let cursor = 0;
      const result: AlignedLine[] = [];
      selected.forEach((line, index) => {
        const piece: number[] = pieces[index];
        let a = 0,
          b = piece.length;
        while (
          a < b &&
          punctuation.test(transcriber.tokenizer.decode([piece[a]]))
        )
          a++;
        while (
          b > a &&
          punctuation.test(transcriber.tokenizer.decode([piece[b - 1]]))
        )
          b--;
        if (
          segment.lineIds.includes(line.id) &&
          (!verifyEvidence ||
            supportsAcousticText(actualScores![index], silentScores![index]))
        ) {
          const rows = transcriber.model.generation_config.alignment_heads.map(
            ([layer, head]: [number, number]) => {
              // Onset attention belongs to the supplied token's decoder row,
              // not the previous row that predicts it.
              const tensor = output[`cross_attentions.${layer}`].slice(
                null,
                head,
                [prefix.length + cursor + a, prefix.length + cursor + a + 1],
                [0, frames],
              );
              const row = Float32Array.from(tensor.data);
              tensor.dispose?.();
              return row;
            },
          );
          const onset =
            index === 0
              ? refineTokenOnset(
                  rows,
                  times[cursor + a] * 1000,
                  times[cursor + a + 1] * 1000,
                )
              : times[cursor + a] * 1000;
          result.push({
            ...line,
            startMs: Math.round(segment.startMs + onset),
            endMs: Math.round(segment.startMs + times[cursor + b] * 1000),
            status: "estimated",
            cueIds: segment.evidenceCueIds,
            ...(line.status === "manual"
              ? {
                  startMs: line.startMs,
                  endMs: line.endMs,
                  status: "manual" as const,
                  cueIds: line.cueIds,
                }
              : {}),
          });
        }
        cursor += piece.length;
      });
      return {
        lines: result,
        scores: new Map(
          selected.flatMap((line, i) =>
            actualScores ? [[line.id, actualScores[i]] as const] : [],
          ),
        ),
      };
    } finally {
      timestamps?.dispose?.();
      decoder.dispose();
      for (const value of Object.values(inputs)) (value as any)?.dispose?.();
      for (const value of Object.values(output ?? {}))
        (value as any)?.dispose?.();
    }
  }
  async transcribe({ pcm, language }: RecognitionInput): Promise<string> {
    if (
      !this.pipeline ||
      !pcm.length ||
      pcm.length > 480000 ||
      pcm.some((v) => !Number.isFinite(v)) ||
      !["ja", "zh", "en", "auto"].includes(language)
    )
      throw new Error("辨識片段不合法");
    const output = await this.pipeline(pcm, {
      // 3.8.1 defaults omitted language to English; it does not auto-detect.
      language: language === "auto" ? "en" : language,
      task: "transcribe",
      max_new_tokens: 160,
      do_sample: false,
      return_timestamps: false,
    });
    if (typeof output?.text !== "string")
      throw new Error("音訊辨識沒有文字結果");
    return output.text;
  }
  async dispose() {
    await this.pipeline?.dispose();
    this.pipeline = undefined;
  }
}
