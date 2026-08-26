#!/usr/bin/env node

// src/stop.ts
import { appendFileSync as appendFileSync2, existsSync as existsSync3, mkdirSync as mkdirSync3 } from "node:fs";
import { dirname as dirname3, join as join2 } from "node:path";
import { fileURLToPath } from "node:url";

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
function captureLogPath() {
  return join(configDir(), "capture.log");
}

// src/session-state.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
function readSessionState(claudeCodeSessionId) {
  const path = sessionStatePath(claudeCodeSessionId);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return {
      ...raw,
      currentLine: raw.currentLine ?? 0,
      lastExtractedLine: raw.lastExtractedLine ?? 0
    };
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
function incrementTurn(claudeCodeSessionId, currentLine) {
  const state = readSessionState(claudeCodeSessionId);
  if (!state) return null;
  state.currentTurnIdx += 1;
  if (currentLine !== void 0) state.currentLine = currentLine;
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

// src/hook-input.ts
import { readFileSync as readFileSync2 } from "node:fs";
var KEYS = [
  "session_id",
  "transcript_path",
  "cwd",
  "hook_event_name",
  "stop_hook_active",
  "source",
  "reason"
];
function parseHookInput(raw) {
  if (!raw.trim()) return {};
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!obj || typeof obj !== "object") return {};
  const out = {};
  for (const k of KEYS) {
    const v = obj[k];
    if (v !== void 0) out[k] = v;
  }
  return out;
}
function readHookInput() {
  try {
    return parseHookInput(readFileSync2(0, "utf8"));
  } catch {
    return {};
  }
}

// src/capture-log.ts
import { appendFileSync, existsSync as existsSync2, mkdirSync as mkdirSync2 } from "node:fs";
import { dirname as dirname2 } from "node:path";
function logCapture(event, fields = {}) {
  try {
    const path = captureLogPath();
    if (!existsSync2(dirname2(path))) mkdirSync2(dirname2(path), { recursive: true });
    appendFileSync(path, JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), event, ...fields }) + "\n");
  } catch {
  }
}

// src/transcript-lines.ts
import { readFileSync as readFileSync3 } from "node:fs";
function countTranscriptLines(path) {
  if (!path) return 0;
  let buf;
  try {
    buf = readFileSync3(path);
  } catch {
    return 0;
  }
  if (buf.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++;
  if (buf[buf.length - 1] !== 10) n++;
  return n;
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
  const mode = (process.env["ARCADEDB_EXTRACTOR"] ?? "live").toLowerCase();
  if (mode === "off") {
    logCapture("skip", { reason: "off" });
    return;
  }
  const dispatchMode = mode === "dryrun" ? "dryrun" : "live";
  const input = readHookInput();
  if (input.stop_hook_active) {
    logCapture("skip", { reason: "stop_hook_active", session: input.session_id });
    return;
  }
  if (!input.session_id) {
    logCapture("skip", { reason: "no_session_id" });
    return;
  }
  const currentLine = countTranscriptLines(input.transcript_path);
  const state = incrementTurn(input.session_id, currentLine > 0 ? currentLine : void 0);
  if (!state) {
    logCapture("skip", { reason: "no_state", session: input.session_id });
    return;
  }
  const tripped = shouldExtract(
    state,
    { turns: DEFAULT_TURNS, intervalMs: DEFAULT_INTERVAL_MS },
    /* @__PURE__ */ new Date()
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
  const cliPath = root ? join2(root, "hooks", "cli.js") : join2(dirname3(fileURLToPath(import.meta.url)), "cli.js");
  const cli = `node ${cliPath}`;
  logCapture("trigger", { session: input.session_id, sessionDbId: state.sessionDbId, lines, turn: state.currentTurnIdx });
  process.stdout.write(JSON.stringify({
    decision: "block",
    reason: `ARCADEDB extraction is due. You MUST now dispatch the extractor subagent (subagent_type=extractor) with these parameters, then continue normally:
- session_id: ${input.session_id}
- sessionDbId: ${state.sessionDbId}
- repo: ${state.repo}
- userName: ${state.userName}
- lines: ${lines}
- turn: ${state.currentTurnIdx}
- transcript_path: ${input.transcript_path ?? "(unavailable)"}
- cli: ${cli}
- mode: ${dispatchMode}
Do not skip this. After the subagent reports back, resume the conversation.`
  }) + "\n");
}
function logError(err) {
  try {
    const path = hookErrorLogPath();
    if (!existsSync3(dirname3(path))) mkdirSync3(dirname3(path), { recursive: true });
    appendFileSync2(path, `[${(/* @__PURE__ */ new Date()).toISOString()}] stop: ${err?.message ?? String(err)}
`);
  } catch {
  }
}
main().catch((err) => {
  logError(err);
  process.exit(0);
});
