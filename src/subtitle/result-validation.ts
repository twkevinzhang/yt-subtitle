import type { AlignedLine } from './library-contract';
import type { PreparedLyrics, ResultValidation, SelectedSource, PlayableCue } from './types';
import { prepareLyrics } from './source-input';
const validRange = (start: unknown, end: unknown, duration: number): boolean =>
  typeof start === 'number' && typeof end === 'number' && Number.isFinite(start) && Number.isFinite(end) &&
  start >= 0 && start < end && end <= duration && Math.round(start*1000) < Math.round(end*1000);

export function validateAligned(lyrics: PreparedLyrics, result: readonly AlignedLine[], durationSeconds: number): ResultValidation {
  if (!lyrics.lyrics.length || !Number.isFinite(durationSeconds) || durationSeconds <= 0)
    return {kind:'invalid',code:'INVALID_INPUT'};
  if (result.length !== lyrics.lyrics.length || result.some((line,index) => line.line !== lyrics.lyrics[index]))
    return {kind:'invalid',code:'CONTRACT_VIOLATION'};
  const lineIndexes: number[] = [], cues: PlayableCue[] = [];
  let previousStart = -Infinity;
  result.forEach((line,index) => {
    const ordered = typeof line.start === 'number' && line.start >= previousStart;
    if (typeof line.start === 'number' && Number.isFinite(line.start)) previousStart = line.start;
    if (!line.matched || !validRange(line.start,line.end,durationSeconds) || !ordered || !Number.isFinite(line.score)) {
      lineIndexes.push(lyrics.sourceLineIndexes[index]);
    } else cues.push({sourceLineIndex:lyrics.sourceLineIndexes[index],text:lyrics.lyrics[index],startMs:Math.round(line.start!*1000),endMs:Math.round(line.end!*1000)});
  });
  return lineIndexes.length ? {kind:'incomplete',lineIndexes} : {kind:'complete',cues};
}
export function validateSource(source: SelectedSource, durationSeconds: number): ResultValidation | {kind:'untimed'; lyrics: PreparedLyrics} {
  const lyrics = prepareLyrics(source.rawText);
  if (!lyrics.lyrics.length || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return {kind:'invalid',code:'INVALID_INPUT'};
  if (source.timings === undefined) return {kind:'untimed',lyrics};
  if (source.timings.length !== lyrics.lyrics.length || source.timings.some((time,index)=>time.sourceLineIndex !== lyrics.sourceLineIndexes[index]))
    return {kind:'invalid',code:'INVALID_SOURCE_TIMING'};
  const result=validateAligned(lyrics,source.timings.map((time,index)=>({line:lyrics.lyrics[index],start:time.start,end:time.end,score:1,matched:true})),durationSeconds);
  return result.kind==='incomplete' ? {kind:'invalid',code:'INVALID_SOURCE_TIMING'} : result;
}
