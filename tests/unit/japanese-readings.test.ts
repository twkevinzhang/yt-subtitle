import { it, expect, vi } from "vitest";
import { JapaneseReadings } from "../../src/acoustic/japanese-readings";
it("retains unknown Latin tokens and reuses packaged dictionary readings", async () => {
  const tokenize = vi.fn((text: string) =>
    text === "君の声"
      ? [{ surface_form: text, pronunciation: "キミノコエ" }]
      : [{ surface_form: text }],
  );
  const load = vi.fn(async () => ({ tokenize }));
  const reading = new JapaneseReadings(load);
  expect(await reading.convert(["君の声", "Neo-ism"])).toEqual([
    "キミノコエ",
    "Neo-ism",
  ]);
  expect(await reading.convert(["君の声"])).toEqual(["キミノコエ"]);
  expect(load).toHaveBeenCalledTimes(1);
  expect(tokenize).toHaveBeenCalledTimes(2);
  await expect(reading.convert(["a".repeat(4001)])).rejects.toThrow(/上限/);
});
