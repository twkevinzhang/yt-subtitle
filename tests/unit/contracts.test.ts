import { describe,it,expect } from 'vitest';
import { cueSchema, lineSchema, validateMessage } from '../../src/shared/schemas';
describe('boundary contracts',()=>{
 it('rejects arbitrary page commands',()=>expect(()=>validateMessage({type:'fetch',url:'https://evil.test'})).toThrow());
 it('rejects nonfinite cue times',()=>expect(()=>cueSchema.parse({id:'c',text:'a',startMs:0,endMs:Infinity})).toThrow());
 it('allows unaligned lines without invented timing',()=>expect(lineSchema.parse({id:'l',original:'歌',cueIds:[],status:'unaligned',excluded:false}).startMs).toBeUndefined());
});
