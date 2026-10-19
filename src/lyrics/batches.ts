import type {AlignedLine,Cue} from '../shared/types';
export interface AlignmentBatch {lines:AlignedLine[];cues:Cue[]}
export function makeBatches(lines:AlignedLine[],cues:Cue[]):AlignmentBatch[]{
 // Keep full caption context so repeated choruses can be disambiguated across lyric batches.
 const batches:AlignmentBatch[]=[];for(let i=0;i<lines.length;i+=40)batches.push({lines:lines.slice(i,i+40),cues});return batches;
}
