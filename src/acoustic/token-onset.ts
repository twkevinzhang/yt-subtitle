// DTW assigns every frame, including gaps, to a token. Refine only the start
// inside that token's existing interval, using the model's acoustic attention.
export function refineTokenOnset(
  rows: Float32Array[],
  startMs: number,
  endMs: number,
) {
  if (
    !rows.length ||
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs
  )
    return startMs;
  const from = Math.max(0, Math.ceil(startMs / 20)),
    to = Math.min(...rows.map((r) => r.length - 1), Math.floor(endMs / 20));
  if (to - from < 3) return startMs;
  const curve = new Float32Array(to - from + 1);
  let total = 0,
    peak = 0,
    peakIndex = 0;
  for (let i = from; i <= to; i++) {
    let value = 0;
    for (const row of rows) {
      if (!Number.isFinite(row[i]) || row[i] < 0) return startMs;
      value += row[i] / rows.length;
    }
    curve[i - from] = value;
    total += value;
    if (value > peak) {
      peak = value;
      peakIndex = i - from;
    }
  }
  if (!peak || peak <= (2 * total) / curve.length) return startMs;
  let onset = peakIndex;
  while (onset > 0 && curve[onset - 1] >= peak * 0.5) onset--;
  return Math.max(startMs, Math.min(endMs - 20, (from + onset) * 20));
}
