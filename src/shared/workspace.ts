import type {
  SearchGroupSnapshot,
  SearchRoute,
} from "../background/search-group";
import type { AlignmentProgress } from "../acoustic/alignment-policy";
import type {
  AlignmentMode,
  DisplayMode,
  SavedResult,
  SubtitleLine,
  SubtitleSource,
  VideoContext,
} from "./types";
export interface RequestEditorState {
  draft: string;
  original: string;
  mode: "form" | "json";
  open: boolean;
}
export type AlignmentCheckpoint = Pick<
  AlignmentProgress,
  "checked" | "ready" | "phase" | "error"
>;
export interface WorkspacePanel {
  text: string;
  lines: SubtitleLine[];
  mode: DisplayMode;
  offset: number;
  onlyPending: boolean;
  runMode: AlignmentMode;
  resumeView: "search" | "edit" | "paste" | "saved";
  source: SubtitleSource;
  manualId?: string;
  provenance?: {
    targetLanguage: "ja" | "zh-Hant" | "en";
    model: string;
    source: SavedResult["source"];
  };
  editors: Partial<Record<SearchRoute, RequestEditorState>>;
  activeRoute: SearchRoute;
  alignment?: AlignmentCheckpoint;
  notice?: string;
  error?: string;
}
export interface VideoWorkspace {
  schemaVersion: 1;
  reset?: true;
  videoId: string;
  generation: string;
  updatedAt: number;
  panel?: WorkspacePanel;
  search?: SearchGroupSnapshot;
  video?: VideoContext;
}
export type WorkspacePatch = Partial<
  Pick<VideoWorkspace, "panel" | "search" | "video">
>;
