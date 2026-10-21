interface Tokenizer {
  tokenize(
    text: string,
  ): { pronunciation?: string; reading?: string; surface_form: string }[];
}
/** Packaged dictionary only; conversion does not consult an AI or send lyrics. */
export class JapaneseReadings {
  private tokenizer?: Promise<Tokenizer>;
  private cache = new Map<string, string>();
  constructor(
    private load: () => Promise<Tokenizer> = async () => {
      const url = new URL("../vendor/kuromoji.js", import.meta.url).href;
      await import(/* @vite-ignore */ url);
      const kuromoji = (globalThis as any).kuromoji;
      if (!kuromoji) throw new Error("本機日文讀音詞典未載入");
      // kuromoji's path.join collapses URL schemes. A same-origin absolute path
      // keeps dictionary XHRs inside the extension and works in its module Worker.
      const dicPath = new URL("../vendor/kuromoji-dict/", import.meta.url)
        .pathname;
      return new Promise<Tokenizer>((resolve, reject) =>
        kuromoji
          .builder({ dicPath })
          .build((error: unknown, tokenizer: Tokenizer) =>
            error ? reject(error) : resolve(tokenizer),
          ),
      );
    },
  ) {}
  async convert(texts: string[]) {
    if (
      texts.length > 256 ||
      texts.some((s) => typeof s !== "string" || s.length > 4000) ||
      texts.reduce((n, s) => n + s.length, 0) > 200000
    )
      throw new Error("讀音文字超過上限");
    const tokenizer = await (this.tokenizer ??= this.load().catch((error) => {
      this.tokenizer = undefined;
      throw error;
    }));
    return texts.map((text) => {
      const cached = this.cache.get(text);
      if (cached !== undefined) return cached;
      const reading = tokenizer
        .tokenize(text)
        .map((t) => t.pronunciation ?? t.reading ?? t.surface_form)
        .join("");
      if (this.cache.size >= 512)
        this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(text, reading);
      return reading;
    });
  }
}
