import type { CaptionTrack } from "../shared/types";
export const manualTracks = (tracks: CaptionTrack[]) =>
  tracks.filter((t) => t.isAuto === false && t.isTranslated === false);
export function selectManualTrack(
  tracks: CaptionTrack[],
  selectedId: string | undefined,
  targetLanguage: string,
) {
  const candidates = manualTracks(tracks),
    canonical = (v: string) => v.toLowerCase().replace(/_/g, "-");
  return (
    candidates.find((t) => t.id === selectedId) ??
    candidates.find(
      (t) => canonical(t.language) === canonical(targetLanguage),
    ) ??
    candidates.find(
      (t) =>
        canonical(t.language).split("-")[0] ===
        canonical(targetLanguage).split("-")[0],
    ) ??
    candidates[0]
  );
}
