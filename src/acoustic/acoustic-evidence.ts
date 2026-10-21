/** Teacher-forced token likelihood, with a stable full-vocabulary softmax. */
export function tokenLogProbability(
  data: ArrayLike<number>,
  row: number,
  vocabulary: number,
  token: number,
) {
  const offset = row * vocabulary;
  if (
    !Number.isInteger(row) ||
    row < 0 ||
    !Number.isInteger(vocabulary) ||
    vocabulary < 1 ||
    !Number.isInteger(token) ||
    token < 0 ||
    token >= vocabulary ||
    data.length < offset + vocabulary
  )
    throw new Error("聲學驗證的 logits 維度不合法");
  let maximum = -Infinity;
  for (let i = 0; i < vocabulary; i++)
    maximum = Math.max(maximum, data[offset + i]);
  let total = 0;
  for (let i = 0; i < vocabulary; i++)
    total += Math.exp(data[offset + i] - maximum);
  return data[offset + token] - maximum - Math.log(total);
}

/** Silence is only a likelihood control; its alignment never supplies a time. */
export function supportsAcousticText(actual: number, silent: number) {
  return (
    Number.isFinite(actual) &&
    Number.isFinite(silent) &&
    actual <= 0 &&
    silent <= 0 &&
    actual - silent >= 1
  );
}
