import {it,expect} from 'vitest';
import {validateCaptionUrl,chooseTracks} from '../../src/youtube/context';
import {currentBinding} from '../../src/youtube/lifecycle';
it('rejects forged arbitrary fetch URLs',()=>{expect(()=>validateCaptionUrl('https://evil.test/api')).toThrow();expect(()=>validateCaptionUrl('https://www.youtube.com/api/timedtext?x=1')).not.toThrow()});
it('prefers original manual captions without deleting automatic choice',()=>expect(chooseTracks([{id:'auto',language:'ja',isAuto:true,isTranslated:false},{id:'manual',language:'ja',isAuto:false,isTranslated:false},{id:'translated',language:'en',isAuto:false,isTranslated:true}] as any).map(x=>x.id)).toEqual(['manual','auto','translated']));
it('does not attach to nonwatch or missing players',()=>expect(currentBinding()).toBeNull());
