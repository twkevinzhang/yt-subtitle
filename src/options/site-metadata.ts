export interface Website {
  domain: string;
  url: string;
}
export interface WebsitePreview extends Website {
  name: string;
  iconDataUrl?: string;
  notice: string;
}

export function normalizeWebsite(input: string): Website {
  const raw = input.trim();
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new Error("請輸入有效的網站網址或網域，例如 lrclib.net。");
  }
  const domain = url.hostname.toLowerCase().replace(/^www\./, "");
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    domain.length > 253 ||
    !domain
      .split(".")
      .every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)) ||
    !/\.[a-z]{2,63}$/.test(domain)
  )
    throw new Error("請輸入有效的網站網址或網域，例如 lrclib.net。");
  return { domain, url: `https://${url.hostname.toLowerCase()}/` };
}

export function parseSiteMetadata(html: string, baseUrl: string) {
  // Template contents remain inert: never attach website markup to the live page.
  const template = document.createElement("template");
  template.innerHTML = html;
  const doc = template.content;
  const clean = (value?: string | null) =>
    value?.replace(/\s+/g, " ").trim().slice(0, 100);
  const name =
    clean(
      doc
        .querySelector('meta[property="og:site_name" i]')
        ?.getAttribute("content"),
    ) ||
    clean(
      doc
        .querySelector('meta[name="application-name" i]')
        ?.getAttribute("content"),
    ) ||
    clean(doc.querySelector("title")?.textContent) ||
    new URL(baseUrl).hostname.replace(/^www\./, "");
  const origin = new URL(baseUrl).origin;
  const icons: string[] = [];
  for (const link of doc.querySelectorAll("link[rel][href]")) {
    if (
      !/^(?:icon|shortcut icon|apple-touch-icon(?:-precomposed)?)$/i.test(
        link.getAttribute("rel")!.trim(),
      )
    )
      continue;
    try {
      const url = new URL(link.getAttribute("href")!, baseUrl);
      if (
        url.protocol === "https:" &&
        url.origin === origin &&
        !url.username &&
        !url.password
      )
        icons.push(url.href);
    } catch {
      /* An invalid icon link does not invalidate the website. */
    }
  }
  icons.push(new URL("/favicon.ico", baseUrl).href);
  return { name, icons: [...new Set(icons)].slice(0, 4) };
}

async function readLimited(
  response: Response,
  limit: number,
): Promise<Uint8Array> {
  if (
    !response.ok ||
    !response.body ||
    Number(response.headers.get("content-length")) > limit
  )
    throw new Error("網站回應無法讀取");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("網站回應過大");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function fetchSiteResource(
  url: string,
  domain: string,
  signal: AbortSignal,
) {
  const response = await fetch(url, {
    signal,
    credentials: "omit",
    referrerPolicy: "no-referrer",
    redirect: "follow",
  });
  const final = new URL(response.url || url);
  if (
    final.protocol !== "https:" ||
    ![domain, `www.${domain}`].includes(final.hostname) ||
    final.port
  )
    throw new Error("網站轉址到其他網域");
  return response;
}

async function rasterizeIcon(
  bytes: Uint8Array,
  type: string,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const objectUrl = URL.createObjectURL(
    new Blob([bytes as BlobPart], { type }),
  );
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        image.onload = null;
        image.onerror = null;
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        cleanup();
        image.src = "";
        reject(new Error("圖示讀取中斷"));
      };
      image.onload = () => {
        cleanup();
        resolve();
      };
      image.onerror = () => {
        cleanup();
        reject(new Error("圖示格式無法辨識"));
      };
      signal.addEventListener("abort", abort, { once: true });
      image.src = objectUrl;
    });
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error("圖示沒有尺寸");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("無法處理圖示");
    const scale = Math.min(64 / image.naturalWidth, 64 / image.naturalHeight);
    const width = image.naturalWidth * scale,
      height = image.naturalHeight * scale;
    context.drawImage(
      image,
      (64 - width) / 2,
      (64 - height) / 2,
      width,
      height,
    );
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// Called directly by paste, Enter, or click so permission requests retain user activation.
export async function identifyWebsite(
  input: string,
  signal?: AbortSignal,
  onlyExistingPermission = false,
): Promise<WebsitePreview> {
  const website = normalizeWebsite(input);
  const fallback: WebsitePreview = {
    ...website,
    name: website.domain,
    notice: "無法讀取網站資訊，使用網域與預設圖示；名稱可自行修改。",
  };
  let granted = false;
  try {
    const permissions = {
      origins: [
        `https://${website.domain}/*`,
        `https://www.${website.domain}/*`,
      ],
    };
    granted = onlyExistingPermission
      ? await chrome.permissions.contains(permissions)
      : await chrome.permissions.request(permissions);
  } catch {
    /* Unavailable permission UI still permits adding a source manually. */
  }
  if (!granted)
    return {
      ...fallback,
      notice: onlyExistingPermission
        ? "已辨識網域。按「辨識網站」授權讀取網站名稱與圖示；也可使用預設圖示直接新增。"
        : "未取得網站讀取權限，使用網域與預設圖示；仍可修改名稱並新增。",
    };
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 10000);
  let name = website.domain;
  let icons = [new URL("/favicon.ico", website.url).href];
  try {
    try {
      const response = await fetchSiteResource(
        website.url,
        website.domain,
        controller.signal,
      );
      const bytes = await readLimited(response, 512_000);
      const charset =
        response.headers
          .get("content-type")
          ?.match(/charset=["']?([^;\s"']+)/i)?.[1] || "utf-8";
      let decoder: TextDecoder;
      try {
        decoder = new TextDecoder(charset);
      } catch {
        decoder = new TextDecoder();
      }
      ({ name, icons } = parseSiteMetadata(
        decoder.decode(bytes),
        response.url || website.url,
      ));
    } catch {
      /* Even when HTML is blocked, a root favicon may still be available. */
    }
    for (const url of icons) {
      if (controller.signal.aborted) break;
      try {
        const response = await fetchSiteResource(
          url,
          website.domain,
          controller.signal,
        );
        const type =
          response.headers.get("content-type")?.split(";")[0].trim() ||
          "image/x-icon";
        if (!type.startsWith("image/")) continue;
        const bytes = await readLimited(response, 256_000);
        const iconDataUrl = await rasterizeIcon(bytes, type, controller.signal);
        return {
          ...website,
          name,
          iconDataUrl,
          notice: "已讀取網站圖示；請確認顯示名稱後新增。",
        };
      } catch {
        /* Try the next declared icon, then use the default icon. */
      }
    }
    return {
      ...fallback,
      name,
      notice:
        name !== website.domain
          ? "已讀取網站名稱；找不到可用圖示，使用預設圖示。"
          : fallback.notice,
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
