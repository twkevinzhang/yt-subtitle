import {it,expect} from 'vitest';
import {parseLyrics,validateTiming} from '../../src/lyrics/formats';
const bytes=(s:string)=>new TextEncoder().encode(s);
it('expands LRC repeats and offset without deleting later chorus',()=>{const l=parseLyrics(bytes('[offset:100]\n[00:01.00][00:03.00]歌'),'lrc',5000);expect(l.map(x=>[x.startMs,x.endMs])).toEqual([[1100,3100],[3100,5000]])});
it('keeps pasted lines unaligned',()=>expect(parseLyrics(bytes('one\ntwo'),'txt',3000).map(x=>x.status)).toEqual(['unaligned','unaligned']));
it('reads SRT multiline and validates negative offsets',()=>{const l=parseLyrics(bytes('1\r\n00:00:01,000 --> 00:00:02,500\r\none\r\ntwo'),'srt',3000);expect(l[0].original).toBe('one\ntwo');expect(validateTiming(l,3000,-2000)[0].code).toBe('invalid-time')});
it('rejects invalid UTF8, oversized files and enhanced LRC',()=>{expect(()=>parseLyrics(new Uint8Array([255]),'txt',1000)).toThrow();expect(()=>parseLyrics(new Uint8Array(2097153),'txt',1000)).toThrow();expect(()=>parseLyrics(bytes('[00:01.00]<00:01.00>word'),'lrc',3000)).toThrow()});
it('rejects exceeding cue counts',()=>expect(()=>parseLyrics(bytes(Array(10001).fill('x').join('\n')),'txt',1000)).toThrow());
