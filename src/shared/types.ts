export type Language='ja'|'zh'|'en';
export type TargetLanguage='ja'|'zh-Hant'|'en';
export type DisplayMode='original'|'bilingual'|'translation';
export interface Cue {id:string;startMs:number;endMs:number;text:string}
export interface AlignedLine {id:string;original:string;translation?:string;startMs?:number;endMs?:number;cueIds:string[];status:'anchor'|'estimated'|'unaligned'|'manual';excluded:boolean}
export interface VideoContext {schemaVersion:1;videoId:string;title:string;channel:string;description:string;durationMs:number}
export interface CaptionTrack {schemaVersion:1;id:string;language:string;label:string;isAuto:boolean;isTranslated:boolean;url:string}
export interface ProviderSettings {schemaVersion:1;baseUrl:string;apiToken:string;model:string;cfClientId?:string;cfClientSecret?:string}
export interface SourceSettings {schemaVersion:1;id:string;name:string;domain:string;includeSubdomains:boolean;enabled:boolean}
export interface Preferences {mode:DisplayMode;targetLanguage:TargetLanguage;fontSize:number;position:'top'|'bottom'}
export interface PublicSettings {baseUrl:string;model:string;configured:boolean;settingsRevision:number;sources:SourceSettings[];preferences:Preferences}
export interface SearchEvidence {status:'unverified'|'verified';citations:string[];toolEvidence?:string}
export interface CompletionEnvelope {payload:unknown;evidence:SearchEvidence}
export interface ChatMessage {role:'system'|'user';content:string}
export interface LyricCandidate {schemaVersion:1;id:string;title:string;artist:string;version:string;language:string;sourceId:string;url:string;fullText:string|null;syncedLyrics:string|null;matchReason:string;evidence:SearchEvidence}
export interface ConsentReceipt {purpose:'search'|'generate'|'search-test';inputHash:string;settingsRevision:number;confirmedAt:number}
export interface GenerationInput {video:VideoContext;lines:AlignedLine[];cues:Cue[];targetLanguage:TargetLanguage;translate:boolean;consent:ConsentReceipt}
export interface ResultKey {videoId:string;inputHash:string;targetLanguage:TargetLanguage;schemaVersion:1}
export interface SavedResult {schemaVersion:1;key:ResultKey;videoDurationMs:number;source:{kind:'network'|'user';url?:string;version?:string};lines:AlignedLine[];offsetMs:number;model:string;createdAt:number;updatedAt:number}
export interface RunState {schemaVersion:1;runId:string;tabId:number;videoId:string;settingsRevision:number;phase:'searching'|'aligning'|'complete'|'cancelled'|'interrupted'|'failed';startedAt:number;deadlineAt:number;requestCount:number;completedLineIds:string[];errorCode?:string}
export interface PlayerBinding {video:HTMLVideoElement;container:HTMLElement;videoId:string;isAd():boolean}
