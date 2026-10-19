import type {AlignedLine,DisplayMode} from '../shared/types';
import {validateTiming} from './formats';
const stamp=(n:number)=>{n=Math.round(n);return `${String(Math.floor(n/3600000)).padStart(2,'0')}:${String(Math.floor(n/60000)%60).padStart(2,'0')}:${String(Math.floor(n/1000)%60).padStart(2,'0')},${String(n%1000).padStart(3,'0')}`};
export function toSrt(lines:AlignedLine[],mode:DisplayMode,offsetMs:number,durationMs:number):string{
 if(validateTiming(lines,durationMs,offsetMs).some(x=>x.severity==='error'))throw new Error('請先校正或排除未對齊及無效時間的句子');
 const active=lines.filter(l=>!l.excluded);if(mode!=='original'&&active.some(l=>!l.translation?.trim()))throw new Error('部分譯文尚未生成');
 return active.map((l,i)=>`${i+1}\n${stamp(l.startMs!+offsetMs)} --> ${stamp(l.endMs!+offsetMs)}\n${mode==='original'?l.original:mode==='translation'?l.translation:`${l.original}\n${l.translation}`}\n`).join('\n');
}
export function safeFilename(title:string){return title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,120)||'lyrics'}
