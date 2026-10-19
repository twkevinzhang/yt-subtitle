import {it,expect} from 'vitest';
import {validateCandidates,searchMessages} from '../../src/lyrics/search';
const source={schemaVersion:1 as const,id:'s',name:'s',domain:'example.com',includeSubdomains:false,enabled:true};
const candidate={id:'a',title:'song',artist:'artist',version:'live',language:'ja',sourceId:'s',url:'https://example.com/lyrics',fullText:null,syncedLyrics:null,matchReason:'matches'};
const evidence={status:'unverified' as const,citations:[]};
it('rejects spoofed domains and disabled sources',()=>{expect(validateCandidates({candidates:[{...candidate,url:'https://example.com.evil.test/lyrics'}]},[source],evidence)).toEqual([]);expect(validateCandidates({candidates:[candidate]},[{...source,enabled:false}],evidence)).toEqual([])});
it('retains source links with missing full text and ignores model verification',()=>{const c=validateCandidates({candidates:[{...candidate,evidence:{status:'verified'}}]},[source],evidence);expect(c[0].fullText).toBeNull();expect(c[0].evidence.status).toBe('unverified')});
it('requires enabled sources',()=>expect(()=>searchMessages({title:'x'} as any,[])).toThrow());
