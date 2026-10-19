import { z } from 'zod';
import type { AlignedLine } from '../shared/types';

export const MODEL_REVISION = '608c49e61301901684bc36cac8f74b95ff6b5a8e';
export const MODEL_ID = 'onnx-community/whisper-base_timestamped';
export const IDLE_MS = 300000;
export const SEGMENT_TIMEOUT_MS = 30000;
export const CANCEL_GRACE_MS = 5000;
export const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
export const jobKeySchema = z.object({runId:z.string().min(1),tabId:z.number().int().nonnegative(),videoId:z.string().min(1),draftRevision:z.number().int().nonnegative()}).strict();
export type JobKey = z.infer<typeof jobKeySchema>;
const ids = z.array(z.string().min(1)).max(10000).refine(v=>new Set(v).size===v.length,'行 ID 重複');
export const segmentSchema = z.object({
  id:z.string().min(1),lineIds:ids.refine(v=>v.length>0,'沒有演唱句'),contextLineIds:ids,
  startMs:z.number().finite().nonnegative(),endMs:z.number().finite().positive(),
  language:z.enum(['ja','zh','en']),evidenceCueIds:ids,occurrence:z.number().int().positive(),
}).strict().refine(s=>s.endMs>s.startMs&&s.endMs-s.startMs<=30000,'片段時間不合法或超過 30 秒')
 .refine(s=>!s.contextLineIds.some(id=>s.lineIds.includes(id)),'上下文不可重複擁有句子');
export type Segment = z.infer<typeof segmentSchema>;
export type ModelState = 'unloaded'|'loading'|'ready'|'busy'|'disposal';
export type SegmentState = 'pending'|'waiting-audio'|'needs-location'|'running'|'verified'|'needs-review'|'failed';
export interface SegmentResult {key:JobKey;segmentId:string;sequence:number;lines:AlignedLine[];diagnostics?:string[]}
export interface AlignmentSnapshot {key:JobKey;sequence:number;lines:AlignedLine[];segments:Record<string,SegmentState>;modelState:ModelState}
export interface TimeRange {startMs:number;endMs:number}
export function assertJobKey(expected:JobKey,actual:JobKey) {
  jobKeySchema.parse(actual);
  if (expected.runId!==actual.runId||expected.tabId!==actual.tabId||expected.videoId!==actual.videoId||expected.draftRevision!==actual.draftRevision) throw new Error('工作或歌詞版本已改變');
}
export function assertSegmentLines(segment:Segment,lineIds:string[]) {
  segmentSchema.parse(segment);
  const known=new Set(lineIds);
  if([...segment.lineIds,...segment.contextLineIds].some(id=>!known.has(id))) throw new Error('片段含未知歌詞 ID');
}

// Release gate: fixture inference does not establish YouTube audio acquisition.
export const YOUTUBE_ACOUSTIC_ENABLED = false;
