import { expect, it } from "vitest";
import { alignmentRequest } from "../../src/lyrics/alignment-request";
import { alignmentBodySchema } from "../../src/shared/schemas";
it("puts all 81 lines and transcript into one valid request", () => {
  const lines = Array.from({ length: 81 }, (_, i) => ({
    id: `l${i}`,
    original: `歌${i}`,
    status: "unaligned" as const,
    cueIds: [],
    excluded: false,
  }));
  const cues = [{ id: "c0", startMs: 0, endMs: 300000, text: "完整轉錄稿" }];
  const body = alignmentBodySchema.parse(alignmentRequest("m", lines, cues));
  const payload = JSON.parse(body.messages[1].content);
  expect(payload.lines).toHaveLength(81);
  expect(payload.lines.at(-1).id).toBe("l80");
  expect(payload.cues).toEqual(cues);
});
