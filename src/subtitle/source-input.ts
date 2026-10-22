import type { PreparedLyrics } from './types';
export function prepareLyrics(rawText: string): PreparedLyrics {
  const lines = rawText.split(/\r\n|\n|\r/u);
  const sourceLineIndexes = lines.flatMap((line, index) => line.trim() ? [index] : []);
  return {rawText, lyrics: sourceLineIndexes.map(index => lines[index]), sourceLineIndexes};
}
