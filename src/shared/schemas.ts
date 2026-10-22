import { z } from "zod";
const time = z.number().finite().nonnegative();
const endpoint = z.object({
  valueMs: time,
  origin: z.enum(["source", "manual", "model"]),
  locked: z.boolean(),
});
export const timingSchema = z.object({
  start: endpoint.optional(),
  end: endpoint.optional(),
  rejected: z
    .object({ startMs: z.number().optional(), endMs: z.number().optional() })
    .optional(),
  warning: z.string().optional(),
});
export const subtitleSourceSchema = z
  .object({
    kind: z.enum([
      "configured",
      "comments",
      "web",
      "youtube",
      "paste",
      "legacy",
    ]),
    url: z.string().url().optional(),
    trackId: z.string().optional(),
  })
  .strict();
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
  timing: timingSchema.optional(),
  id: z.string(),
  original: z.string(),
  alignmentText: z.string().optional(),
  translation: z.string().optional(),
  startMs: time.optional(),
  endMs: time.optional(),
  timingHint: z
    .object({ startMs: time, endMs: time })
    .refine((h) => h.endMs > h.startMs)
    .optional(),
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
  iconDataUrl: z
    .string()
    .max(100_000)
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/)
    .optional(),
});
export const preferencesSchema = z.object({
  autoSearchApproved: z.boolean().default(false),
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
const selectedSourceSchema = z.object({
  rawText: z.string().max(2_000_000),
  languageHint: z.string().max(50).optional(),
  timings: z
    .array(
      z.object({
        sourceLineIndex: z.number().int().nonnegative(),
        start: z.number().finite(),
        end: z.number().finite(),
      }),
    )
    .max(10000)
    .readonly()
    .optional(),
});
const msg = z.discriminatedUnion("type", [
  z.object({ type: z.literal("subtitle-ensure") }),
  z.object({ type: z.literal("subtitle-snapshot") }),
  z.object({ type: z.literal("subtitle-reset") }),
  z.object({ type: z.literal("subtitle-cancel") }),
  z.object({
    type: z.literal("subtitle-entry-mode"),
    mode: z.enum(["ai", "paste"]),
  }),
  z.object({
    type: z.literal("subtitle-retry-search"),
    route: z.enum(["configured", "comments", "web"]),
  }),
  z.object({
    type: z.literal("subtitle-select"),
    source: selectedSourceSchema,
  }),
  z.object({ type: z.literal("settings-public") }),
  z.object({ type: z.literal("settings-edit") }),
  z.object({
    type: z.literal("settings-save"),
    provider: providerSchema,
    sources: z.array(sourceSchema),
    preferences: preferencesSchema,
  }),
  z.object({
    type: z.literal("preferences-save"),
    preferences: preferencesSchema,
  }),
  z.object({ type: z.literal("clear-credentials") }),
  z.object({ type: z.literal("models"), provider: providerSchema }),
  z.object({ type: z.literal("connection-check") }),
  z.object({ type: z.literal("open-options") }),
  z.object({ type: z.literal("inspect") }),
  z.object({
    type: z.literal("search-test"),
    body: searchTestBodySchema,
    consent: consentSchema,
  }),
  z.object({ type: z.literal("run"), runId: z.string() }),
  z.object({ type: z.literal("cancel"), runId: z.string() }),
  z.object({ type: z.literal("results-list"), videoId: z.string().optional() }),
  z.object({ type: z.literal("results-delete"), key: z.unknown() }),
  z.object({ type: z.literal("results-clear") }),
]);
export function validateMessage(value: unknown) {
  return msg.parse(value);
}
export type ExtensionMessage = z.input<typeof msg>;
