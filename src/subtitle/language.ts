export type AlignLanguage = "en" | "ja" | "zh";

const KANA = /[぀-ヿ]/gu;
const IDEOGRAPH = /\p{Script=Han}/gu;
const LATIN = /[A-Za-z]/g;

/**
 * Guesses the lyrics language from the text itself when the source did not
 * say. Any kana means Japanese; otherwise mostly ideographs means Chinese.
 */
export function detectLanguage(lines: readonly string[]): AlignLanguage {
  const text = lines.join("\n");
  const kana = text.match(KANA)?.length ?? 0;
  if (kana > 0) return "ja";
  const han = text.match(IDEOGRAPH)?.length ?? 0;
  const latin = text.match(LATIN)?.length ?? 0;
  return han > latin ? "zh" : "en";
}
