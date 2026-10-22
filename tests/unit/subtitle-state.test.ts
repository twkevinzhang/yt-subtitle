import { expect, it } from 'vitest';
import { reduceJob, toDashboardSteps, initialJob } from '../../src/subtitle/job-state';
const key={tabId:1,videoId:'abcdefghijk',sourceFingerprint:'source',generation:1};
it('ignores stale generations and out of order messages',()=>{
  const state=initialJob(key);
  expect(reduceJob(state,{...state,sequence:0,phase:'complete'})).toBe(state);
  expect(reduceJob(state,{...state,key:{...key,generation:0},sequence:2})).toBe(state);
  expect(reduceJob(state,{...state,sequence:1,phase:'preparing-model'}).phase).toBe('preparing-model');
});
it('maps preparing and transcription to the same shared five steps',()=>{
  expect(toDashboardSteps({...initialJob(key),phase:'preparing-model'}).map(s=>s.status)).toEqual(['done','done','active','waiting','waiting']);
  expect(toDashboardSteps({...initialJob(key),phase:'transcribing'}).map(s=>s.status)).toEqual(['done','done','done','active','waiting']);
  expect(toDashboardSteps({...initialJob(key),phase:'validating'}).map(s=>s.status)).toEqual(['done','done','done','active','waiting']);
});
it('does not pretend selection is audio download and skips model on timed route',()=>{
  expect(toDashboardSteps(initialJob(key)).map(s=>s.status)).toEqual(['done','waiting','waiting','waiting','waiting']);
  expect(toDashboardSteps({...initialJob(key),timed:true,phase:'complete'}).map(s=>s.status)).toEqual(['done','skipped','skipped','skipped','done']);
});
