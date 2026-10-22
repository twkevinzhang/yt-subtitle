import type { LyricAlignBinding } from "./library-contract";
/** The release remains an intact static ES module so its Worker URL stays valid. */
export async function resolveLibrary(
  importer: (url: string) => Promise<unknown> = (url) =>
    import(/* @vite-ignore */ url),
): Promise<LyricAlignBinding> {
  const url =
    typeof chrome !== "undefined" && chrome.runtime?.getURL
      ? chrome.runtime.getURL("vendor/lyric-align-ts/index.js")
      : new URL(
          /* @vite-ignore */ "../../vendor/lyric-align-ts/index.js",
          import.meta.url,
        ).href;
  const module = (await importer(url)) as {
    createBinding?: () => LyricAlignBinding;
  };
  const binding = module.createBinding?.();
  if (
    !binding ||
    binding.capabilities.contractVersion !== 1 ||
    binding.capabilities.libraryVersion !== "0.1.0" ||
    typeof binding.createSession !== "function"
  )
    throw Object.assign(new Error("lyric-align-ts 發布物不符合固定契約"), {
      code: "CONTRACT_VIOLATION",
    });
  return binding;
}
