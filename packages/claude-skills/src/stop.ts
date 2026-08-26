#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hookErrorLogPath } from "./env-paths.js";
import { incrementTurn } from "./session-state.js";
import { shouldExtract } from "./rate-limit.js";
import { readHookInput } from "./hook-input.js";
import { logCapture } from "./capture-log.js";
import { countTranscriptLines } from "./transcript-lines.js";

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
  if (mode === "off") { logCapture("skip", { reason: "off" }); return; }
  const dispatchMode = mode === "dryrun" ? "dryrun" : "live";

  const input = readHookInput();
  if (input.stop_hook_active) { logCapture("skip", { reason: "stop_hook_active", session: input.session_id }); return; }
  if (!input.session_id) { logCapture("skip", { reason: "no_session_id" }); return; }

  const currentLine = countTranscriptLines(input.transcript_path);
  const state = incrementTurn(input.session_id, currentLine > 0 ? currentLine : undefined);
  if (!state) { logCapture("skip", { reason: "no_state", session: input.session_id }); return; }

  const tripped = shouldExtract(
    state,
    { turns: DEFAULT_TURNS, intervalMs: DEFAULT_INTERVAL_MS },
    new Date(),
  );
  if (!tripped) {
    logCapture("skip", { reason: "not_due", session: input.session_id, turn: state.currentTurnIdx, line: currentLine });
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
      `- mode: ${dispatchMode}\n` +
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
