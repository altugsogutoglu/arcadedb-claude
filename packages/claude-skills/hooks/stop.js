#!/usr/bin/env node

// src/stop.ts
import { appendFileSync, existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2 } from "node:fs";
import { dirname as dirname2 } from "node:path";

// src/env-paths.ts
import { homedir } from "node:os";
import { join } from "node:path";
function configDir() {
  return join(homedir(), ".config", "arcadedb");
}
function hookErrorLogPath() {
  return join(configDir(), "hook-errors.log");
}
function sessionsDir() {
  return join(configDir(), "sessions");
}
function sessionStatePath(claudeCodeSessionId) {
  return join(sessionsDir(), `${claudeCodeSessionId}.json`);
}

// src/session-state.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
function readSessionState(claudeCodeSessionId) {
  const path = sessionStatePath(claudeCodeSessionId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
function writeSessionState(state) {
  const path = sessionStatePath(state.claudeCodeSessionId);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
}
function incrementTurn(claudeCodeSessionId) {
  const state = readSessionState(claudeCodeSessionId);
  if (!state) return null;
  state.currentTurnIdx += 1;
  writeSessionState(state);
  return state;
}

// src/rate-limit.ts
function shouldExtract(state, cfg, now) {
  const delta = state.currentTurnIdx - state.lastExtractedTurnIdx;
  if (delta <= 0) return false;
  if (delta >= cfg.turns) return true;
  const last = new Date(state.lastExtractedAt).getTime();
  if (Number.isNaN(last)) return false;
  return now.getTime() - last >= cfg.intervalMs;
}

// src/stop.ts
function envInt(name, fallback) {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
var DEFAULT_TURNS = envInt("ARCADEDB_EXTRACT_TURNS", 10);
var DEFAULT_INTERVAL_MS = envInt("ARCADEDB_EXTRACT_INTERVAL_MS", 15 * 60 * 1e3);
async function main() {
  const mode = process.env["ARCADEDB_EXTRACTOR"];
  if (mode !== "dryrun") {
    return;
  }
  const raw = readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
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
    /* @__PURE__ */ new Date()
  );
  if (!tripped) return;
  const turnRange = `${state.lastExtractedTurnIdx + 1}..${state.currentTurnIdx}`;
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: `ARCADEDB_EXTRACT_DRYRUN: dispatch the extractor subagent (subagent_type=extractor) for session ${state.sessionDbId}, claudeCodeSessionId ${payload.session_id}, repo ${state.repo}, userName ${state.userName}, turns ${turnRange}, transcript at ${payload.transcript_path ?? "(unavailable)"}. After it finishes, continue normally.`
  }) + "\n");
}
function readStdin() {
  try {
    return readFileSync2(0, "utf8");
  } catch {
    return "";
  }
}
function logError(err) {
  try {
    const path = hookErrorLogPath();
    if (!existsSync2(dirname2(path))) mkdirSync2(dirname2(path), { recursive: true });
    appendFileSync(path, `[${(/* @__PURE__ */ new Date()).toISOString()}] stop: ${err?.message ?? String(err)}
`);
  } catch {
  }
}
main().catch((err) => {
  logError(err);
  process.exit(0);
});
