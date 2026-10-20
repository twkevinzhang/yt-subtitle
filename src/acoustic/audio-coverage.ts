// Seconds on the media timeline. Keep the union, including evicted ranges.
export class AudioCoverage {
  private ranges: number[][] = [];
  add(incoming: number[][]) {
    if (
      incoming.length > 1000 ||
      incoming.some(
        (r) =>
          r.length !== 2 ||
          !r.every(Number.isFinite) ||
          r[0] < 0 ||
          r[1] <= r[0],
      )
    )
      throw new Error("音訊範圍不合法");
    const sorted = [...this.ranges, ...incoming].sort((a, b) => a[0] - b[0]);
    this.ranges = [];
    for (const range of sorted) {
      const previous = this.ranges.at(-1);
      if (previous && range[0] <= previous[1] + 0.04)
        previous[1] = Math.max(previous[1], range[1]);
      else this.ranges.push([...range]);
    }
  }
  get edge() {
    return this.edgeFrom(0);
  }
  edgeFrom(position: number) {
    return (
      this.ranges.find(
        (r) => r[0] <= position + 0.08 && r[1] > position,
      )?.[1] ?? 0
    );
  }
  complete(duration: number) {
    return (
      Number.isFinite(duration) && duration > 0 && this.edge >= duration - 0.08
    );
  }
}
