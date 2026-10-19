import { expect, it, vi } from "vitest";
import { fetchModelAsset } from "../../src/acoustic/model-assets";
it("falls back to the fixed model data URL when an unbundled file cannot be fetched", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("ERR_FILE_NOT_FOUND"))
    .mockResolvedValueOnce(new Response("model"));
  const bytes = await fetchModelAsset("config.json", fetcher);
  expect(new TextDecoder().decode(bytes)).toBe("model");
  expect(fetcher.mock.calls[1][0]).toBe(
    "https://huggingface.co/onnx-community/whisper-base_timestamped/resolve/608c49e61301901684bc36cac8f74b95ff6b5a8e/config.json",
  );
  expect(fetcher.mock.calls[1][1].credentials).toBe("omit");
});
it("refuses model paths outside the fixed manifest", async () => {
  const fetcher = vi.fn();
  await expect(fetchModelAsset("../other", fetcher)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
