import { describe, it, expect } from 'vitest';
import { prepareLyrics } from '../../src/subtitle/source-input';
import { validateAligned, validateSource } from '../../src/subtitle/result-validation';
describe('subtitle result boundary', () => {
  it('preserves raw CRLF, Unicode, spaces and duplicate line indexes', () => {
    expect(prepareLyrics(' 唱詞 \r\n\r\n 唱詞 \r\n')).toEqual({rawText:' 唱詞 \r\n\r\n 唱詞 \r\n',lyrics:[' 唱詞 ',' 唱詞 '],sourceLineIndexes:[0,2]});
  });
  it('rejects partially timed sources rather than realigning', () => {
    expect(validateSource({rawText:'a\nb',timings:[{sourceLineIndex:0,start:0,end:1}]},10).kind).toBe('invalid');
  });
  it('preserves complete source timestamps', () => {
    expect(validateSource({rawText:'a',timings:[{sourceLineIndex:0,start:1.23,end:2.34}]},10)).toEqual({kind:'complete',cues:[{sourceLineIndex:0,text:'a',startMs:1230,endMs:2340}]});
  });
  it.each([null,NaN,-1,11])('does not publish invalid aligned endpoint %s', end => {
    expect(validateAligned(prepareLyrics('a'),[{line:'a',start:0,end,matched:true,score:.8}],10)).toEqual({kind:'incomplete',lineIndexes:[0]});
  });
  it('counts unmatched and backward rows once per source line', () => {
    expect(validateAligned(prepareLyrics('a\n\nb'),[{line:'a',start:2,end:3,matched:false,score:.1},{line:'b',start:1,end:2,matched:true,score:.9}],10)).toEqual({kind:'incomplete',lineIndexes:[0,2]});
  });
  it('rejects changed text, missing rows, and rounding collapse', () => {
    const lyrics=prepareLyrics('a');
    expect(validateAligned(lyrics,[],10).kind).toBe('invalid');
    expect(validateAligned(lyrics,[{line:'b',start:0,end:1,matched:true,score:1}],10).kind).toBe('invalid');
    expect(validateAligned(lyrics,[{line:'a',start:.0001,end:.0002,matched:true,score:1}],10).kind).toBe('incomplete');
  });
  it('rejects empty lyrics and invalid duration', () => {
    expect(validateSource({rawText:'\n '},10).kind).toBe('invalid');
    expect(validateSource({rawText:'a'},NaN).kind).toBe('invalid');
  });
});
