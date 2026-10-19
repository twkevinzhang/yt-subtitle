import { z } from "zod";
const time = z.number().finite().nonnegative();
export const cueSchema = z
  .object({
    id: z.string(),
    startMs: time,
    endMs: time,
    text: z.string(),
    endEstimated: z.boolean().optional(),
    tokens: z
      .array(z.object({ text: z.string(), startMs: time }))
      .max(10000)
      .optional(),
  })
  .refine((c) => c.endMs > c.startMs, "結束必須晚於開始");
export const lineSchema = z.object({
  id: z.string(),
  original: z.string(),
  alignmentText: z.string().optional(),
  translation: z.string().optional(),
  startMs: time.optional(),
  endMs: time.optional(),
  cueIds: z.array(z.string()),
  status: z.enum(["anchor", "estimated", "unaligned", "manual"]),
  excluded: z.boolean(),
});
export const videoSchema = z.object({
  schemaVersion: z.literal(1),
  videoId: z.string().regex(/^[\w-]{11}$/),
  title: z.string().max(2000),
  channel: z.string().max(1000),
  description: z.string().max(20000),
  durationMs: time,
});
export const sourceSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  domain: z.string().min(1).max(253),
  includeSubdomains: z.boolean(),
  enabled: z.boolean(),
});
export const preferencesSchema = z.object({
  mode: z.enum(["original", "bilingual", "translation"]),
  targetLanguage: z.enum(["ja", "zh-Hant", "en"]),
  fontSize: z.number().min(14).max(64),
  position: z.enum(["top", "bottom"]),
});
export const providerSchema = z.object({
  schemaVersion: z.literal(1),
  baseUrl: z.string().url(),
  apiToken: z.string().trim().min(1),
  // Credentials may be saved before fetching and selecting a model.
  model: z.string().trim(),
  cfClientId: z.string().optional(),
  cfClientSecret: z.string().optional(),
});
export const consentSchema = z.object({
  purpose: z.enum(["search", "generate", "search-test"]),
  inputHash: z.string(),
  settingsRevision: z.number().int(),
  confirmedAt: time,
});
export const searchTestBodySchema = z
  .object({
    model: z
      .string()
      .min(1)
      .refine((value) => !!value.trim()),
    input: z.union([z.string().min(1), z.array(z.unknown()).min(1)]),
    stream: z.literal(false),
    store: z.literal(false),
  })
  .passthrough()
  .refine(
    (body) => JSON.stringify(body).length <= 120000,
    "Request body 超過 120000 字元",
  );
export const alignmentBodySchema = z
  .object({
    model: z.string().trim().min(1),
    messages: z
      .array(
        z.object({
          role: z.enum(["system", "user", "assistant"]),
          content: z.string(),
        }),
      )
      .min(1),
    stream: z.literal(false),
  })
  .passthrough()
  .refine(
    (body) => JSON.stringify(body).length <= 120000,
    "Request body 超過 120000 字元",
  );
const msg = z.discriminatedUnion("type", [
  z.object({ type: z.literal("audio-begin") }),
  z.object({
    type: z.literal("audio-chunk"),
    assetId: z.string(),
    sequence: z.number().int().nonnegative(),
    base64: z.string().max(350000),
  }),
  z.object({ type: z.literal("audio-finish"), assetId: z.string() }),
  z.object({ type: z.literal("audio-clear") }),
  z.object({
    type: z.literal("acoustic-position"),
    runId: z.string(),
    timeMs: time,
  }),
  z.object({ type: z.literal("settings-public") }),
  z.object({ type: z.literal("settings-edit") }),
  z.object({
    type: z.literal("settings-save"),
    provider: providerSchema,
    sources: z.array(sourceSchema),
    preferences: preferencesSchema,
  }),
  z.object({ type: z.literal("clear-credentials") }),
  z.object({ type: z.literal("models"), provider: providerSchema }),
  z.object({ type: z.literal("connection-check") }),
  z.object({ type: z.literal("open-options") }),
  z.object({ type: z.literal("inspect") }),
  z.object({ type: z.literal("read-track"), trackId: z.string() }),
  z.object({ type: z.literal("read-transcript") }),
  z.object({
    type: z.literal("search"),
    video: videoSchema,
    consent: consentSchema,
  }),
  z.object({
    type: z.literal("search-test"),
    body: searchTestBodySchema,
    consent: consentSchema,
  }),
  z.object({
    type: z.literal("generate"),
    input: z.object({
      video: videoSchema,
      lines: z.array(lineSchema).max(10000),
      cues: z.array(cueSchema).max(20000),
      targetLanguage: z.enum(["ja", "zh-Hant", "en"]),
      translate: z.boolean(),
      body: alignmentBodySchema.optional(),
      timingOnly: z.boolean().optional(),
      audioAssetId: z.string().optional(),
      positionMs: time.optional(),
      consent: consentSchema,
    }),
  }),
  z.object({ type: z.literal("cancel"), runId: z.string() }),
  z.object({ type: z.literal("run"), runId: z.string() }),
  z.object({ type: z.literal("results-list"), videoId: z.string().optional() }),
  z.object({ type: z.literal("results-save"), result: z.unknown() }),
  z.object({ type: z.literal("results-delete"), key: z.unknown() }),
  z.object({ type: z.literal("results-clear") }),
]);
export function validateMessage(value: unknown) {
  return msg.parse(value);
}
export type ExtensionMessage = z.infer<typeof msg>;
