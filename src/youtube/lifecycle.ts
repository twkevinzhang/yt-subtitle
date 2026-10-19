import type {PlayerBinding} from '../shared/types';
export function currentBinding():PlayerBinding|null{
 const id=new URL(location.href).searchParams.get('v');if(location.pathname!=='/watch'||!id||!/^[\w-]{11}$/.test(id))return null;
 const container=document.querySelector<HTMLElement>('#movie_player'),video=container?.querySelector<HTMLVideoElement>('video');
 if(!container||!video)return null;return {video,container,videoId:id,isAd:()=>container.classList.contains('ad-showing')||container.classList.contains('ad-interrupting')};
}
export function bindPlayer(onChange:(binding:PlayerBinding|null)=>void){
 let current:PlayerBinding|null=null;
 const check=()=>{const next=currentBinding();if(next?.video!==current?.video||next?.container!==current?.container||next?.videoId!==current?.videoId){current=next;onChange(next)}};
 const observer=new MutationObserver(check);observer.observe(document.documentElement,{subtree:true,childList:true});document.addEventListener('yt-navigate-finish',check);const timer=setInterval(check,1000);check();
 return ()=>{observer.disconnect();clearInterval(timer);document.removeEventListener('yt-navigate-finish',check);onChange(null)};
}
