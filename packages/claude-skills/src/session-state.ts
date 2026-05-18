import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { sessionStatePath } from "./env-paths.js";

export interface SessionState {
  claudeCodeSessionId: string;
  sessionDbId: string;
  repo: string | null;
  cwd: string;
  userName: string;
  startedAt: string;
  currentTurnIdx: number;
  lastExtractedTurnIdx: number;
  lastExtractedAt: string;
}

export function readSessionState(claudeCodeSessionId: string): SessionState | null {
  const path = sessionStatePath(claudeCodeSessionId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SessionState;
  } catch {
    return null;
  }
}

export function writeSessionState(state: SessionState): void {
  const path = sessionStatePath(state.claudeCodeSessionId);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
}
