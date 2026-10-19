import { expect, it } from 'vitest';
import { segmentSchema, assertJobKey, assertSegmentLines } from '../../src/acoustic/contracts';
const key = {runId:'run',tabId:1,videoId:'e1ZMmRlsaaU',draftRevision:1};
const segment = {id:'s1',lineIds:['l1'],contextLineIds:[],startMs:0,endMs:20000,language:'ja' as const,evidenceCueIds:['c1'],occurrence:1};
it('rejects stale job keys',()=>{ expect(()=>assertJobKey(key,{...key,draftRevision:2})).toThrow(); expect(()=>assertJobKey(key,{...key,videoId:'other'})).toThrow(); });
it('rejects unknown or duplicate owner lines',()=>{expect(()=>assertSegmentLines(segment,['l2'])).toThrow(); expect(()=>segmentSchema.parse({...segment,lineIds:['l1','l1']})).toThrow();});
it('rejects segments over thirty seconds and nonfinite ranges',()=>{expect(()=>segmentSchema.parse({...segment,endMs:30001})).toThrow(); expect(()=>segmentSchema.parse({...segment,startMs:NaN})).toThrow(); expect(()=>segmentSchema.parse({...segment,endMs:0})).toThrow();});
it('accepts a bounded complete segment',()=>{expect(segmentSchema.parse(segment)).toEqual(segment); expect(()=>assertSegmentLines(segment,['l1'])).not.toThrow();});

