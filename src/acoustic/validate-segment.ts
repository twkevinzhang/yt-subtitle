import type { AlignedLine } from "../shared/types";
import type { Segment } from "./contracts";
export class AcousticBoundaryError extends Error {}
export function validateSegment(
  result: AlignedLine[],
  segment: Segment,
  all: AlignedLine[],
): { ok: boolean; reason?: string } {
  const fail = (reason: string) => ({ ok: false, reason });
  if (
    result.length !== segment.lineIds.length ||
    new Set(result.map((l) => l.id)).size !== result.length ||
    result.some((l) => !segment.lineIds.includes(l.id))
  )
    return fail("片段結果缺句或 ID 重複");
  const map = new Map(result.map((l) => [l.id, l]));
  let previousEnd = -Infinity;
  for (const original of all) {
    const row = map.get(original.id) ?? original;
    if (map.has(original.id)) {
      if (
        row.original !== original.original ||
        row.excluded !== original.excluded
      )
        return fail("模型改變原文或排除狀態");
      if (
        original.status === "manual" &&
        (row.status !== "manual" ||
          row.startMs !== original.startMs ||
          row.endMs !== original.endMs)
      )
        return fail("人工錨點不可變動");
      if (row.excluded) continue;
      if (
        !Number.isFinite(row.startMs) ||
        !Number.isFinite(row.endMs) ||
        row.startMs! < segment.startMs ||
        row.endMs! > segment.endMs ||
        row.endMs! <= row.startMs!
      )
        return fail("句子時間無效或超過片段");
    }
    if (row.excluded) continue;
    if (row.startMs === undefined || row.endMs === undefined) continue;
    if (row.startMs < previousEnd)
      return fail(
        `句子與相鄰段落時間交錯（${row.id}: ${row.startMs} < ${previousEnd} ms）`,
      );
    previousEnd = row.endMs;
  }
  return { ok: true };
}
