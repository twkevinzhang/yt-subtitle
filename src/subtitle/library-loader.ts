import type { LyricAlignBinding } from "./library-contract";
import type { CreateAligner } from "./library-runner";
import { LIBRARY_VERSION } from "./library-version";
/** The release remains an intact static ES module so its Worker URL stays valid. */
export async function resolveLibrary(
  importer: (url: string) => Promise<unknown> = (url) =>
    import(/* @vite-ignore */ url),
): Promise<LyricAlignBinding> {
  const url =
    typeof chrome !== "undefined" && chrome.runtime?.getURL
      ? chrome.runtime.getURL("vendor/lyric-align-ts/dist/index.js")
      : new URL(
          /* @vite-ignore */ "../../vendor/lyric-align-ts/dist/index.js",
          import.meta.url,
        ).href;
  const module = (await importer(url)) as {
    createBinding?: () => LyricAlignBinding;
  };
  const binding = module.createBinding?.();
  if (
    !binding ||
    binding.capabilities.contractVersion !== 1 ||
    binding.capabilities.libraryVersion !== LIBRARY_VERSION ||
    typeof binding.createSession !== "function"
  )
    throw Object.assign(new Error("lyric-align-ts 發布物不符合固定契約"), {
      code: "CONTRACT_VIOLATION",
    });
  return binding;
}

/** Same pinned release, direct audio + known-lyrics alignment (createAligner). */
export async function resolveAligner(
  importer: (url: string) => Promise<unknown> = (url) =>
    import(/* @vite-ignore */ url),
): Promise<CreateAligner> {
  const url =
    typeof chrome !== "undefined" && chrome.runtime?.getURL
      ? chrome.runtime.getURL("vendor/lyric-align-ts/dist/index.js")
      : new URL(
          /* @vite-ignore */ "../../vendor/lyric-align-ts/dist/index.js",
          import.meta.url,
        ).href;
  const module = (await importer(url)) as {
    createAligner?: CreateAligner;
    createBinding?: () => LyricAlignBinding;
  };
  if (
    typeof module.createAligner !== "function" ||
    module.createBinding?.().capabilities.libraryVersion !== LIBRARY_VERSION
  )
    throw Object.assign(new Error("lyric-align-ts 發布物不符合固定契約"), {
      code: "CONTRACT_VIOLATION",
    });
  return module.createAligner;
}
