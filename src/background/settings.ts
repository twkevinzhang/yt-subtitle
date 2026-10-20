import {
  providerSchema,
  sourceSchema,
  preferencesSchema,
} from "../shared/schemas";
import type {
  ProviderSettings,
  SourceSettings,
  Preferences,
  PublicSettings,
} from "../shared/types";
export interface SettingsRecord {
  provider: ProviderSettings | null;
  sources: SourceSettings[];
  preferences: Preferences;
  revision: number;
}
export const defaults: SettingsRecord = {
  provider: null,
  sources: [
    {
      schemaVersion: 1,
      id: "lrclib",
      name: "LRCLIB",
      domain: "lrclib.net",
      includeSubdomains: false,
      enabled: true,
    },
  ],
  preferences: {
    alignmentMode: "buffer-before-play",
    mode: "original",
    targetLanguage: "zh-Hant",
    fontSize: 28,
    position: "bottom",
  },
  revision: 0,
};
export function normalizeProvider(value: unknown): ProviderSettings {
  const p = providerSchema.parse(value);
  const u = new URL(p.baseUrl);
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !(
      u.protocol === "https:" ||
      (u.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(u.hostname))
    )
  )
    throw new Error("服務網址必須使用 HTTPS（本機服務例外）");
  if (Boolean(p.cfClientId?.trim()) !== Boolean(p.cfClientSecret?.trim()))
    throw new Error("Cloudflare ID 與 Secret 必須成對填入");
  return {
    ...p,
    baseUrl: u.href.replace(/\/+$/, ""),
    apiToken: p.apiToken.trim(),
    model: p.model.trim(),
    cfClientId: p.cfClientId?.trim() || undefined,
    cfClientSecret: p.cfClientSecret?.trim() || undefined,
  };
}
export function normalizeSources(values: unknown): SourceSettings[] {
  const sources = sourceSchema.array().max(30).parse(values);
  for (const s of sources) {
    s.domain = s.domain.trim().toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(s.domain))
      throw new Error("來源請填網域，例如 example.com");
  }
  if (new Set(sources.map((s) => s.id)).size !== sources.length)
    throw new Error("來源 ID 重複");
  return sources;
}
export function publicSettings(r: SettingsRecord): PublicSettings {
  return {
    baseUrl: r.provider?.baseUrl || "",
    model: r.provider?.model || "",
    configured: !!r.provider?.model,
    settingsRevision: r.revision,
    sources: r.sources,
    preferences: r.preferences,
  };
}
let ready: Promise<void> | undefined;
export function protectStorage() {
  return (ready ??= chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  }));
}
export async function getSettings(): Promise<SettingsRecord> {
  await protectStorage();
  const raw = (await chrome.storage.local.get("settings")).settings;
  if (!raw) return structuredClone(defaults);
  return {
    ...raw,
    provider: raw.provider ? normalizeProvider(raw.provider) : null,
    sources: normalizeSources(raw.sources),
    preferences: preferencesSchema.parse(raw.preferences),
  };
}
export async function getPublicSettings() {
  return publicSettings(await getSettings());
}
export async function saveSettings(
  provider: unknown,
  sources: unknown,
  preferences: unknown,
) {
  const old = await getSettings();
  const record = {
    provider: normalizeProvider(provider),
    sources: normalizeSources(sources),
    preferences: preferencesSchema.parse(preferences),
    revision: old.revision + 1,
  };
  await chrome.storage.local.set({ settings: record });
  return publicSettings(record);
}
export async function clearCredentials() {
  const record = await getSettings();
  record.provider = null;
  record.revision++;
  await chrome.storage.local.set({ settings: record });
}
