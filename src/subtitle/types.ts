export interface SelectedSource {
  rawText: string;
  languageHint?: string;
  timings?: readonly { sourceLineIndex: number; start: number; end: number }[];
}
export interface PreparedLyrics {
  rawText: string;
  lyrics: readonly string[];
  sourceLineIndexes: readonly number[];
}
export interface PlayableCue {
  sourceLineIndex: number;
  text: string;
  startMs: number;
  endMs: number;
}
export type ResultValidation =
  | { kind: 'complete'; cues: readonly PlayableCue[] }
  | { kind: 'incomplete'; lineIndexes: readonly number[] }
  | { kind: 'invalid'; code: string };
