import type { TranslationPreferences } from "./translation";
export type Language = "ja" | "zh" | "en";
export type TargetLanguage = "ja" | "zh-Hant" | "en";
export type DisplayMode = "original" | "bilingual" | "translation";

export interface SubtitleSource {
  kind: "configured" | "comments" | "web" | "youtube" | "paste" | "legacy";
  url?: string;
  trackId?: string;
}
export interface TimingEndpoint {
  valueMs: number;
  origin: "source" | "manual" | "model";
  locked: boolean;
}
export interface LineTiming {
  start?: TimingEndpoint;
  end?: TimingEndpoint;
  rejected?: { startMs?: number; endMs?: number };
  warning?: string;
}
export interface SubtitleLine extends AlignedLine {
  timing: LineTiming;
}
export interface SubtitleDraft {
  revision: number;
  source: SubtitleSource;
  lines: SubtitleLine[];
}
export interface Cue {
  tokens?: { text: string; startMs: number }[];
  endEstimated?: boolean;
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}
export interface AlignedLine {
  timing?: LineTiming;
  id: string;
  original: string;
  // Spoken text when original also contains an adjacent, unsung translation.
  alignmentText?: string;
  translation?: string;
  startMs?: number;
  endMs?: number;
  // Rejected broad AI timing is a search hint, never a playable timestamp.
  timingHint?: { startMs: number; endMs: number };
  cueIds: string[];
  status: "anchor" | "estimated" | "unaligned" | "manual";
  excluded: boolean;
}
export interface VideoContext {
  schemaVersion: 1;
  videoId: string;
  title: string;
  channel: string;
  description: string;
  durationMs: number;
}
export interface CaptionTrack {
  schemaVersion: 1;
  id: string;
  language: string;
  label: string;
  isAuto: boolean;
  isTranslated: boolean;
  url: string;
}
export interface ProviderSettings {
  schemaVersion: 1;
  baseUrl: string;
  apiToken: string;
  model: string;
  cfClientId?: string;
  cfClientSecret?: string;
}
export interface Preferences {
  autoSearchApproved?: boolean;
  mode: DisplayMode;
  targetLanguage: TargetLanguage;
  fontSize: number;
  position: "top" | "bottom";
  /** Task text for the Google and comments searches; empty means the default. */
  webPrompt?: string;
  commentsPrompt?: string;
  translation?: TranslationPreferences;
}
export interface PublicSettings {
  baseUrl: string;
  model: string;
  configured: boolean;
  settingsRevision: number;
  preferences: Preferences;
}
export interface SearchEvidence {
  status: "unverified" | "verified";
  citations: string[];
  toolEvidence?: string;
}
export interface CompletionEnvelope {
  payload: unknown;
  evidence: SearchEvidence;
}
export interface SearchTestResult {
  text: string;
  evidence: SearchEvidence;
}
export interface SearchHttpResult {
  status: number | null;
  body: unknown;
  error?: string;
  /** The reply as the panel reads it; present for a search test. */
  result?: LyricSearchResult;
  lrclib?: LyricSearchResult;
  comments?: LyricSearchResult;
}
export interface LyricSearchResult {
  text: string;
  candidates: LyricCandidate[];
  error?: string;
}
export interface ChatMessage {
  role: "system" | "user";
  content: string;
}
export interface LyricCandidate {
  schemaVersion: 1;
  id: string;
  title: string;
  artist: string;
  version: string;
  language: string;
  sourceId: string;
  url: string;
  fullText: string | null;
  syncedLyrics: string | null;
  matchReason: string;
  evidence: SearchEvidence;
}
export interface ConsentReceipt {
  purpose: "search" | "generate" | "search-test";
  inputHash: string;
  settingsRevision: number;
  confirmedAt: number;
}
export interface GenerationInput {
  video: VideoContext;
  lines: AlignedLine[];
  cues: Cue[];
  targetLanguage: TargetLanguage;
  translate: boolean;
  consent: ConsentReceipt;
}
export interface ResultKey {
  videoId: string;
  inputHash: string;
  targetLanguage: TargetLanguage;
  schemaVersion: 1;
}
export interface SavedResult {
  subtitleSource?: SubtitleSource;
  schemaVersion: 1;
  key: ResultKey;
  videoDurationMs: number;
  source: { kind: "network" | "user"; url?: string; version?: string };
  lines: AlignedLine[];
  offsetMs: number;
  model: string;
  createdAt: number;
  updatedAt: number;
}
export interface RunState {
  schemaVersion: 1;
  runId: string;
  tabId: number;
  videoId: string;
  settingsRevision: number;
  phase:
    | "searching"
    | "aligning"
    | "complete"
    | "cancelled"
    | "interrupted"
    | "failed";
  startedAt: number;
  deadlineAt: number;
  requestCount: number;
  completedLineIds: string[];
  errorCode?: string;
}
export interface PlayerBinding {
  video: HTMLVideoElement;
  container: HTMLElement;
  videoId: string;
  isAd(): boolean;
}
