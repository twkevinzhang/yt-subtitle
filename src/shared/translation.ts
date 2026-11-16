export const TRANSLATION_LANGUAGES = [
  { code: "zh-Hant", label: "繁體中文" },
  { code: "zh-Hans", label: "简体中文" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "pt", label: "Português" },
  { code: "ru", label: "Русский" },
] as const;
export type TranslationLanguage =
  (typeof TRANSLATION_LANGUAGES)[number]["code"];
export const TRANSLATION_CODES = TRANSLATION_LANGUAGES.map((l) => l.code) as [
  TranslationLanguage,
  ...TranslationLanguage[],
];
export interface TranslationPreferences {
  /** ask: show the dialog; always: translate without asking; never: do not. */
  ask: "ask" | "always" | "never";
  /** Language used for "always" and preselected in the dialog; empty means the user's own. */
  language?: TranslationLanguage;
  display: "bilingual" | "translation";
  /** Task text for the translation; empty means the default. */
  prompt?: string;
}
export const DEFAULT_TRANSLATION: TranslationPreferences = {
  ask: "ask",
  display: "bilingual",
};
export const languageLabel = (code: string) =>
  TRANSLATION_LANGUAGES.find((l) => l.code === code)?.label ?? code;
/** The user's own language, taken from the browser's language tag. */
export function userLanguage(tag = navigator.language): TranslationLanguage {
  const t = tag.toLowerCase();
  if (t.startsWith("zh"))
    return /hans|-cn|-sg/u.test(t) ? "zh-Hans" : "zh-Hant";
  const base = t.split("-")[0];
  return TRANSLATION_CODES.find((c) => c === base) ?? "en";
}
/** All languages, the user's own first. */
export function orderedLanguages(own: TranslationLanguage) {
  return [
    ...TRANSLATION_LANGUAGES.filter((l) => l.code === own),
    ...TRANSLATION_LANGUAGES.filter((l) => l.code !== own),
  ];
}
const family = (code: string) => code.toLowerCase().split(/[-_]/u)[0];
export function sameLanguage(lyrics: string | undefined, target: string) {
  return !!lyrics && family(lyrics) === family(target);
}
export type TranslationDecision =
  | { kind: "skip" }
  | { kind: "run"; language: TranslationLanguage }
  | { kind: "ask"; language: TranslationLanguage };
/** What to do when the user picks lyrics, given their saved preferences. */
export function decideTranslation(
  prefs: Partial<TranslationPreferences> | undefined,
  lyricsLanguage: string | undefined,
  own: TranslationLanguage = userLanguage(),
): TranslationDecision {
  const { ask, language } = { ...DEFAULT_TRANSLATION, ...prefs };
  const target = language ?? own;
  if (ask === "never") return { kind: "skip" };
  if (ask === "always")
    return sameLanguage(lyricsLanguage, target)
      ? { kind: "skip" }
      : { kind: "run", language: target };
  return sameLanguage(lyricsLanguage, own)
    ? { kind: "skip" }
    : { kind: "ask", language: target };
}
