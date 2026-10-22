import type { RunState } from "../shared/types";
export interface RunRecord {
  state: RunState;
  output?: unknown;
  partial?: unknown;
}
