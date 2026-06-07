#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { hookErrorLogPath } from "./env-paths.js";
import { incrementTurn } from "./session-state.js";
import { shouldExtract } from "./rate-limit.js";

interface StopPayload {
  session_id?: string;
  stop_hook_active?: boolean;
  transcript_path?: string;
  hook_event_name?: string;
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
const DEFAULT_TURNS = envInt("ARCADEDB_EXTRACT_TURNS", 10);
const DEFAULT_INTERVAL_MS = envInt("ARCADEDB_EXTRACT_INTERVAL_MS", 15 * 60 * 1000);

async function main(): Promise<void> {
  const mode = (process.env["ARCADEDB_EXTRACTOR"] ?? "live").toLowerCase();
  if (mode === "off") return;
  const dispatchMode = mode === "dryrun" ? "dryrun" : "live";

  const raw = readStdin();
  let payload: StopPayload;
  try {
    payload = JSON.parse(raw) as StopPayload;
  } catch {
    return;
  }

  if (payload.stop_hook_active) return;
  if (!payload.session_id) return;

  const state = incrementTurn(payload.session_id);
  if (!state) return;

  const tripped = shouldExtract(
    state,
    { turns: DEFAULT_TURNS, intervalMs: DEFAULT_INTERVAL_MS },
    new Date(),
  );
  if (!tripped) return;

  const turnRange = `${state.lastExtractedTurnIdx + 1}..${state.currentTurnIdx}`;

  process.stdout.write(JSON.stringify({
    decision: "block",
    reason:
      `ARCADEDB extraction is due. You MUST now dispatch the extractor subagent ` +
      `(subagent_type=extractor) with these parameters, then continue normally:\n` +
      `- session_id: ${payload.session_id}\n` +
      `- sessionDbId: ${state.sessionDbId}\n` +
      `- repo: ${state.repo}\n` +
      `- userName: ${state.userName}\n` +
      `- turns: ${turnRange}\n` +
      `- transcript_path: ${payload.transcript_path ?? "(unavailable)"}\n` +
      `- mode: pass --mode ${dispatchMode} to extract-write\n` +
      `Do not skip this. After the subagent reports back, resume the conversation.`,
  }) + "\n");
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function logError(err: unknown): void {
  try {
    const path = hookErrorLogPath();
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `[${new Date().toISOString()}] stop: ${(err as Error)?.message ?? String(err)}\n`);
  } catch { /* give up */ }
}

main().catch(err => {
  logError(err);
  process.exit(0);
});
