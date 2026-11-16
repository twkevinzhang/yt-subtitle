import { providerSchema, preferencesSchema } from "../shared/schemas";
import type {
  ProviderSettings,
  Preferences,
  PublicSettings,
} from "../shared/types";
export interface SettingsRecord {
  provider: ProviderSettings | null;
  preferences: Preferences;
  revision: number;
}
export const defaults: SettingsRecord = {
  provider: null,
  preferences: {
    autoSearchApproved: false,
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
export function publicSettings(r: SettingsRecord): PublicSettings {
  return {
    baseUrl: r.provider?.baseUrl || "",
    model: r.provider?.model || "",
    configured: !!r.provider?.model,
    settingsRevision: r.revision,
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
  // Records saved before the source list was removed carry a stale `sources` key.
  return {
    provider: raw.provider ? normalizeProvider(raw.provider) : null,
    preferences: preferencesSchema.parse(raw.preferences),
    revision: raw.revision,
  };
}
export async function getPublicSettings() {
  return publicSettings(await getSettings());
}
export async function saveSettings(provider: unknown, preferences: unknown) {
  const old = await getSettings();
  const record = {
    provider: normalizeProvider(provider),
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
export async function savePreferences(preferences: unknown) {
  const record = await getSettings();
  record.preferences = preferencesSchema.parse(preferences);
  record.revision++;
  await chrome.storage.local.set({ settings: record });
  return publicSettings(record);
}
/** Saved from the panel's dialog; unlike a settings save it must not restart the work in progress. */
export async function saveTranslation(translation: unknown) {
  const record = await getSettings();
  record.preferences = preferencesSchema.parse({
    ...record.preferences,
    translation,
  });
  await chrome.storage.local.set({ settings: record });
  return publicSettings(record);
}
