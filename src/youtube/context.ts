import {inspectPage,readCaptionPage} from './bridge';
import {videoSchema} from '../shared/schemas';
import {parseYouTubeCaptions} from './captions';
import type {CaptionTrack,Cue,VideoContext} from '../shared/types';
export function validateCaptionUrl(value:string){const u=new URL(value);if(u.protocol!=='https:'||!['www.youtube.com','www.youtube-nocookie.com'].includes(u.hostname)||u.pathname!=='/api/timedtext'||u.username||u.password)throw new Error('字幕網址不合法');return u.href}
export function chooseTracks(tracks:CaptionTrack[]){return [...tracks].sort((a,b)=>Number(a.isTranslated)-Number(b.isTranslated)||Number(a.isAuto)-Number(b.isAuto))}
export async function inspectVideo(tabId:number):Promise<{video:VideoContext;tracks:CaptionTrack[]}>{
 const [r]=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:inspectPage});
 if(!r?.result)throw new Error('無法讀取播放器');const data=r.result;
 return {video:videoSchema.parse(data.video),tracks:chooseTracks(data.tracks.filter((t:any)=>{try{validateCaptionUrl(t.url);return typeof t.id==='string'&&typeof t.language==='string'}catch{return false}}))};
}
export async function readTrack(tabId:number,trackId:string,videoId:string):Promise<Cue[]>{const [r]=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:readCaptionPage,args:[trackId,videoId]});if(!r?.result)throw new Error('字幕讀取失敗，請啟用原生字幕後重試');return parseYouTubeCaptions(r.result.raw,r.result.format)}
