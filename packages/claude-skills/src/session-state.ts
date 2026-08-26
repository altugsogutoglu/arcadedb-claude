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
  currentLine: number;
  lastExtractedLine: number;
}

export function readSessionState(claudeCodeSessionId: string): SessionState | null {
  const path = sessionStatePath(claudeCodeSessionId);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<SessionState>;
    return {
      ...(raw as SessionState),
      currentLine: raw.currentLine ?? 0,
      lastExtractedLine: raw.lastExtractedLine ?? 0,
    };
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

export function incrementTurn(claudeCodeSessionId: string, currentLine?: number): SessionState | null {
  const state = readSessionState(claudeCodeSessionId);
  if (!state) return null;
  state.currentTurnIdx += 1;
  if (currentLine !== undefined) state.currentLine = currentLine;
  writeSessionState(state);
  return state;
}

export function markExtracted(claudeCodeSessionId: string, turnIdx: number, lineIdx?: number): SessionState | null {
  const state = readSessionState(claudeCodeSessionId);
  if (!state) return null;
  state.lastExtractedTurnIdx = turnIdx;
  if (lineIdx !== undefined) state.lastExtractedLine = lineIdx;
  state.lastExtractedAt = new Date().toISOString();
  writeSessionState(state);
  return state;
}
