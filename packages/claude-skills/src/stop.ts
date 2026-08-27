#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "./agent-memory/index.js";
import { hookErrorLogPath, projectsJsonPath } from "./env-paths.js";
import { incrementTurn, markCaptured, markExtractInFlight, type SessionState } from "./session-state.js";
import { shouldExtract } from "./rate-limit.js";
import { readHookInput, type HookInput } from "./hook-input.js";
import { logCapture } from "./capture-log.js";
import { countTranscriptLines } from "./transcript-lines.js";
import { parseTranscriptTurns } from "./transcript-turns.js";
import { writeTurns } from "./turn-capture.js";
import { resolveConfig, toClientEnv, type ResolvedConfig } from "./config.js";
import { loadProjects } from "./project-map.js";
import { resolveMemoryDb } from "./memory-db.js";
import { spawnEmbedRunner } from "./embed-spawn.js";
import { isEmbedInstalled } from "./embed.js";

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
const DEFAULT_TURNS = envInt("ARCADEDB_EXTRACT_TURNS", 10);
const DEFAULT_INTERVAL_MS = envInt("ARCADEDB_EXTRACT_INTERVAL_MS", 15 * 60 * 1000);
/** An extraction older than this is assumed dead (subagent killed, session crashed) and may be re-requested. */
export const EXTRACT_IN_FLIGHT_MAX_MS = 10 * 60 * 1000;

async function main(): Promise<void> {
  const input = readHookInput();
  if (input.stop_hook_active) { logCapture("skip", { reason: "stop_hook_active", session: input.session_id }); return; }
  if (!input.session_id) { logCapture("skip", { reason: "no_session_id" }); return; }

  const currentLine = countTranscriptLines(input.transcript_path);
  const state = incrementTurn(input.session_id, currentLine > 0 ? currentLine : undefined);
  if (!state) { logCapture("skip", { reason: "no_state", session: input.session_id }); return; }

  const cfg = resolveConfig();
  const memoryDb = resolveMemoryDb(cfg, loadProjects(projectsJsonPath(), logError));

  // 1. Raw capture: every prompt and answer becomes a :Turn. No model involved.
  if (cfg.capture && input.transcript_path && state.currentLine > state.lastCapturedLine) {
    await captureTurns(cfg, memoryDb, input, state);
  }

  // 2. LLM extractor: opt-in, rate limited, never overlapping.
  if (cfg.extractor === "off") { logCapture("skip", { reason: "extractor_off", session: input.session_id, turn: state.currentTurnIdx }); return; }
  maybeRequestExtraction(cfg, input, state);
}

async function captureTurns(cfg: ResolvedConfig, memoryDb: string, input: HookInput, state: SessionState): Promise<void> {
  const turns = parseTranscriptTurns(input.transcript_path!, state.lastCapturedLine + 1, state.currentLine);
  if (turns.length === 0) {
    markCaptured(state.claudeCodeSessionId, state.currentLine);
    return;
  }
  try {
    const client = new Client(toClientEnv(cfg));
    await writeTurns(client, memoryDb, { sessionDbId: state.sessionDbId, repo: state.repo, turns });
    markCaptured(state.claudeCodeSessionId, state.currentLine);
    logCapture("turns_captured", { session: input.session_id, db: memoryDb, turns: turns.length, lines: `${state.lastCapturedLine + 1}..${state.currentLine}` });
    if (cfg.embed && isEmbedInstalled()) {
      const pid = spawnEmbedRunner({ db: memoryDb });
      if (pid) logCapture("embed_spawned", { db: memoryDb, pid });
    }
  } catch (err) {
    // Lines stay uncaptured and are retried on the next Stop; a server outage loses nothing.
    logError(err);
    logCapture("turns_capture_failed", { session: input.session_id, db: memoryDb, error: (err as Error)?.message ?? String(err) });
  }
}

function maybeRequestExtraction(cfg: ResolvedConfig, input: HookInput, state: SessionState): void {
  const now = new Date();
  if (state.extractInFlightSince) {
    const age = now.getTime() - new Date(state.extractInFlightSince).getTime();
    if (Number.isFinite(age) && age < EXTRACT_IN_FLIGHT_MAX_MS) {
      logCapture("skip", { reason: "extract_in_flight", session: input.session_id, since: state.extractInFlightSince });
      return;
    }
  }

  const tripped = shouldExtract(state, { turns: DEFAULT_TURNS, intervalMs: DEFAULT_INTERVAL_MS }, now);
  if (!tripped) {
    logCapture("skip", { reason: "not_due", session: input.session_id, turn: state.currentTurnIdx, line: state.currentLine });
    return;
  }
  if (state.currentLine <= state.lastExtractedLine) {
    logCapture("skip", { reason: "no_new_lines", session: input.session_id, line: state.currentLine });
    return;
  }

  const lines = `${state.lastExtractedLine + 1}..${state.currentLine}`;
  const root = process.env["CLAUDE_PLUGIN_ROOT"];
  const cliPath = root ? join(root, "hooks", "cli.js") : join(dirname(fileURLToPath(import.meta.url)), "cli.js");
  const cli = `node ${cliPath}`;

  markExtractInFlight(state.claudeCodeSessionId, now);
  logCapture("trigger", { session: input.session_id, sessionDbId: state.sessionDbId, lines, turn: state.currentTurnIdx });

  process.stdout.write(JSON.stringify({
    decision: "block",
    reason:
      `ARCADEDB extraction is due. You MUST now dispatch the extractor subagent ` +
      `(subagent_type=extractor) with these parameters, then continue normally:\n` +
      `- session_id: ${input.session_id}\n` +
      `- sessionDbId: ${state.sessionDbId}\n` +
      `- repo: ${state.repo}\n` +
      `- userName: ${state.userName}\n` +
      `- lines: ${lines}\n` +
      `- turn: ${state.currentTurnIdx}\n` +
      `- transcript_path: ${input.transcript_path ?? "(unavailable)"}\n` +
      `- cli: ${cli}\n` +
      `- mode: ${cfg.extractor}\n` +
      `Do not skip this. After the subagent reports back, resume the conversation.`,
  }) + "\n");
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
