export type EntryMode = "ai" | "paste";
export type SubtitleView = "method" | EntryMode | "processing" | "result";
export function backView(view: SubtitleView, origin: EntryMode): SubtitleView {
  return view === "processing" || view === "result" ? origin : "method";
}
