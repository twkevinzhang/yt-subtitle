import type { Progress } from './library-contract';
export interface JobKey {tabId:number;videoId:string;sourceFingerprint:string;generation:number}
export type JobPhase='searching'|'selecting'|'acquiring-audio'|'preparing-model'|'transcribing'|'aligning'|'validating'|'applying'|'complete'|'incomplete'|'failed'|'cancelled';
export interface JobSnapshot {
  key:JobKey;sequence:number;phase:JobPhase;timed?:boolean;progress?:Progress;
  unmatchedLineIndexes:readonly number[];error?:{code:string;message:string};failedPhase?:JobPhase;
}
export function initialJob(key:JobKey):JobSnapshot {return {key,sequence:0,phase:'selecting',unmatchedLineIndexes:[]};}
export function sameJob(a:JobKey,b:JobKey):boolean {return a.tabId===b.tabId&&a.videoId===b.videoId&&a.sourceFingerprint===b.sourceFingerprint&&a.generation===b.generation;}
export function reduceJob(state:JobSnapshot,event:JobSnapshot):JobSnapshot {
  return sameJob(state.key,event.key)&&event.sequence>state.sequence?event:state;
}
export type StepStatus='waiting'|'active'|'done'|'failed'|'skipped';
const stepIds=['search','audio','model','align','apply'] as const;
const indexFor=(phase:JobPhase)=>phase==='searching'?0:phase==='selecting'?1:phase==='acquiring-audio'?1:phase==='preparing-model'?2:phase==='applying'?4:phase==='complete'?5:3;
export function toDashboardSteps(state:JobSnapshot):readonly {id:string;status:StepStatus}[] {
  const index=indexFor(state.failedPhase??state.phase);
  return stepIds.map((id,i)=>({id,status:state.timed&&i>0&&i<4?'skipped':state.phase==='selecting'?(i===0?'done':'waiting'):i<index?'done':i>index?'waiting':state.phase==='failed'||state.phase==='incomplete'?'failed':state.phase==='cancelled'?'waiting':'active'}));
}
