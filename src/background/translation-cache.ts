import { hashInput } from "./results";

const KEY = "translation-cache";
const MAX_ENTRIES = 30;
type Store = Record<string, { lines: string[]; used: number }>;

/** The same lyrics, language, instruction and model always translate to the saved text. */
export const translationCacheKey = (input: {
  lines: readonly string[];
  language: string;
  prompt?: string;
  model: string;
}) => hashInput({ v: 1, ...input });

const read = async (): Promise<Store> =>
  ((await chrome.storage.local.get(KEY))[KEY] as Store | undefined) ?? {};

export async function getCachedTranslation(key: string) {
  const hit = (await read())[key];
  return hit?.lines;
}
export async function putCachedTranslation(key: string, lines: string[]) {
  const store = await read();
  store[key] = { lines, used: Date.now() };
  const keep = Object.entries(store)
    .sort((a, b) => b[1].used - a[1].used)
    .slice(0, MAX_ENTRIES);
  await chrome.storage.local.set({ [KEY]: Object.fromEntries(keep) });
}
export const clearCachedTranslations = () => chrome.storage.local.remove(KEY);
