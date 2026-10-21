import type { SubtitleLine } from "../shared/types";
import type { Segment } from "./contracts";
import { lyricLanguage } from "./lyric-locator";

/** Source order and actual neighboring endpoints bound these candidates.
 * They carry no inferred time: the acoustic verifier must establish every row.
 */
export function acousticGapSegments(
  lines: SubtitleLine[],
  durationMs: number,
): Segment[] {
  const segments: Segment[] = [];
  let edge = 0;
  let anchored = false;
  let pending: SubtitleLine[] = [];
  const flush = (endMs: number, nextAnchor = false) => {
    if (!pending.length) return;
    if (!anchored && !nextAnchor) {
      pending = [];
      return;
    }
    const startMs = Math.max(edge, pending[0].startMs ?? 0);
    const selected = pending.slice(0, 16);
    const end = Math.min(
      endMs,
      startMs + 30000,
      ...selected.flatMap((l) => (l.endMs === undefined ? [] : [l.endMs])),
    );
    if (end > startMs)
      segments.push({
        id: `acoustic-gap-${selected[0].id}-${startMs}`,
        lineIds: selected.map((l) => l.id),
        contextLineIds: [],
        startMs,
        endMs: end,
        language: lyricLanguage(
          selected.map((l) => l.alignmentText ?? l.original).join(" "),
        ),
        evidenceCueIds: [],
        occurrence: 1,
      });
    pending = [];
  };
  for (const line of lines) {
    if (line.excluded) continue;
    if (line.startMs !== undefined && line.endMs !== undefined) {
      flush(line.startMs, true);
      edge = Math.max(edge, line.endMs);
      anchored = true;
    } else pending.push(line);
  }
  flush(durationMs);
  return segments;
}

/** Revisit unresolved vocals with their real neighboring speech. Only estimates
 * created in this run may move; incoming source endpoints remain context.
 */
export function contextualGapSegments(
  lines: SubtitleLine[],
  incoming: Set<string>,
) {
  const active = lines.filter((l) => !l.excluded);
  const result: { segment: Segment; repairIds: Set<string> }[] = [];
  const complete = (l: SubtitleLine) =>
    l.startMs !== undefined && l.endMs !== undefined;
  for (let i = 0; i < active.length; i++) {
    if (complete(active[i])) continue;
    const from = i;
    while (i + 1 < active.length && !complete(active[i + 1])) i++;
    const before = active[from - 1],
      after = active[i + 1];
    if (
      !before ||
      !after ||
      !complete(before) ||
      !complete(after) ||
      after.endMs! - before.startMs! > 30000 ||
      after.endMs! <= before.startMs!
    )
      continue;
    const neighbors = [before, after];
    const repairIds = new Set(
      neighbors.filter((l) => !incoming.has(l.id)).map((l) => l.id),
    );
    const owned = active.slice(from, i + 1).map((l) => l.id);
    const lineIds = [before, ...active.slice(from, i + 1), after]
      .filter((l) => owned.includes(l.id) || repairIds.has(l.id))
      .map((l) => l.id);
    result.push({
      repairIds,
      segment: {
        id: `context-gap-${active[from].id}`,
        lineIds,
        contextLineIds: neighbors
          .filter((l) => incoming.has(l.id))
          .map((l) => l.id),
        startMs: before.startMs!,
        endMs: after.endMs!,
        language: lyricLanguage(
          active
            .slice(from - 1, i + 2)
            .map((l) => l.alignmentText ?? l.original)
            .join(" "),
        ),
        evidenceCueIds: [],
        occurrence: 1,
      },
    });
  }
  return result;
}
