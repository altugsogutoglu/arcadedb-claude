#!/usr/bin/env node

// src/stop.ts
import { appendFileSync as appendFileSync2, existsSync as existsSync6, mkdirSync as mkdirSync5 } from "node:fs";
import { dirname as dirname5, join as join7 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/agent-memory/errors.ts
var ArcadeDBConnectionError = class extends Error {
  constructor(uri, cause) {
    super(`Could not reach ArcadeDB at ${uri}. Is the container running? Try \`docker ps\`.`);
    this.uri = uri;
    this.cause = cause;
    this.name = "ArcadeDBConnectionError";
  }
  uri;
  cause;
};
var DatabaseNotFoundError = class extends Error {
  constructor(database) {
    super(`Database "${database}" does not exist. Run \`arcadedb-memory migrate ${database}\` to create it.`);
    this.database = database;
    this.name = "DatabaseNotFoundError";
  }
  database;
};

// src/agent-memory/client.ts
var DEFAULT_TIMEOUT_MS = 1e4;
var Client = class {
  constructor(env, options = {}) {
    this.env = env;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }
  env;
  timeoutMs;
  authHeader() {
    return "Basic " + Buffer.from(`${this.env.username}:${this.env.password}`).toString("base64");
  }
  async post(path, body) {
    let res;
    try {
      res = await fetch(`${this.env.httpUri}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: this.authHeader() },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (cause) {
      throw new ArcadeDBConnectionError(this.env.httpUri, cause);
    }
    if (!res.ok) {
      const text = await res.text();
      if (/database.*is not available|database.*not.*found|does not exist/i.test(text)) {
        const m = text.match(/'([^']+)'/);
        throw new DatabaseNotFoundError(m?.[1] ?? "unknown");
      }
      throw new Error(`ArcadeDB ${res.status} ${res.statusText}: ${text}`);
    }
    return await res.json();
  }
  async query(db, language, q) {
    const data = await this.post(`/api/v1/query/${db}`, { language, command: q });
    return data.result;
  }
  async execute(db, language, q) {
    const data = await this.post(`/api/v1/command/${db}`, { language, command: q });
    return data.result;
  }
  async command(serverCommand) {
    return this.post(`/api/v1/server`, { command: serverCommand });
  }
  async listDatabases() {
    let res;
    try {
      res = await fetch(`${this.env.httpUri}/api/v1/databases`, {
        headers: { Authorization: this.authHeader() },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (cause) {
      throw new ArcadeDBConnectionError(this.env.httpUri, cause);
    }
    if (!res.ok) throw new Error(`ArcadeDB ${res.status} ${res.statusText}`);
    const data = await res.json();
    return data.result;
  }
};

// src/agent-memory/env.ts
import { homedir } from "node:os";
import { join } from "node:path";
var DEFAULT_PATH = join(homedir(), ".config", "arcadedb", ".env");

// src/env-paths.ts
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
function configDir() {
  return join2(homedir2(), ".config", "arcadedb");
}
function projectsJsonPath() {
  return join2(configDir(), "projects.json");
}
function hookErrorLogPath() {
  return join2(configDir(), "hook-errors.log");
}
function sessionsDir() {
  return join2(configDir(), "sessions");
}
function sessionStatePath(claudeCodeSessionId) {
  return join2(sessionsDir(), `${claudeCodeSessionId}.json`);
}
function captureLogPath() {
  return join2(configDir(), "capture.log");
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
      lastExtractedLine: raw.lastExtractedLine ?? 0,
      lastCapturedLine: raw.lastCapturedLine ?? raw.lastExtractedLine ?? 0,
      extractInFlightSince: raw.extractInFlightSince ?? null
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
function markExtractInFlight(claudeCodeSessionId, now = /* @__PURE__ */ new Date()) {
  const state = readSessionState(claudeCodeSessionId);
  if (!state) return null;
  state.extractInFlightSince = now.toISOString();
  writeSessionState(state);
  return state;
}
function markCaptured(claudeCodeSessionId, lineIdx) {
  const state = readSessionState(claudeCodeSessionId);
  if (!state) return null;
  state.lastCapturedLine = lineIdx;
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

// src/transcript-turns.ts
import { readFileSync as readFileSync4 } from "node:fs";
var MAX_TURN_CHARS = 32e3;
function parseTranscriptTurns(path, fromLine, toLine) {
  let raw;
  try {
    raw = readFileSync4(path, "utf8");
  } catch {
    return [];
  }
  return parseTurnsFromText(raw, fromLine, toLine);
}
function parseTurnsFromText(raw, fromLine, toLine) {
  const out = [];
  const lines = raw.split("\n");
  const last = Math.min(toLine, lines.length);
  for (let i = Math.max(fromLine, 1); i <= last; i++) {
    const text = lines[i - 1];
    if (!text || !text.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(text);
    } catch {
      continue;
    }
    const turn = turnFromEntry(entry, i);
    if (!turn) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === "assistant" && turn.role === "assistant") {
      prev.text = (prev.text + "\n\n" + turn.text).slice(0, MAX_TURN_CHARS);
      continue;
    }
    out.push(turn);
  }
  return out;
}
function turnFromEntry(entry, line) {
  if (entry.isMeta || entry.isSidechain) return null;
  if (entry.type !== "user" && entry.type !== "assistant") return null;
  const content = entry.message?.content;
  let text;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content.filter((p) => !!p && typeof p === "object" && p.type === "text" && typeof p.text === "string").map((p) => p.text).join("\n");
  } else {
    return null;
  }
  text = cleanText(text);
  if (!text) return null;
  return {
    line,
    role: entry.type,
    text: text.length > MAX_TURN_CHARS ? text.slice(0, MAX_TURN_CHARS) : text,
    ts: entry.timestamp ?? (/* @__PURE__ */ new Date()).toISOString()
  };
}
function cleanText(text) {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "").replace(/<command-(?:name|message|args)>[\s\S]*?<\/command-(?:name|message|args)>/g, "").trim();
}

// src/turn-capture.ts
async function writeTurns(client, db, args) {
  const written = [];
  for (const t of args.turns) {
    const id = `${args.sessionDbId}:${t.line}`;
    const repoClause = args.repo ? `, t.repo = ${cypherStr(args.repo)}` : "";
    await client.execute(
      db,
      "cypher",
      `MERGE (t:Turn {id: ${cypherStr(id)}})
       SET t.sessionId = ${cypherStr(args.sessionDbId)}, t.idx = ${t.line}, t.role = ${cypherStr(t.role)},
           t.text = ${cypherStr(t.text)}, t.ts = datetime(${cypherStr(t.ts)})${repoClause}`
    );
    await client.execute(
      db,
      "cypher",
      `MATCH (t:Turn {id: ${cypherStr(id)}}), (s:Session {id: ${cypherStr(args.sessionDbId)}})
       WHERE NOT (t)-[:DURING]->(s) CREATE (t)-[:DURING]->(s)`
    );
    written.push({ id, line: t.line });
  }
  return written;
}
function cypherStr(s) {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

// src/config.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync3, readFileSync as readFileSync5, writeFileSync as writeFileSync2, renameSync, chmodSync } from "node:fs";
import { dirname as dirname3, join as join3 } from "node:path";
var DEFAULTS = {
  httpUri: "http://localhost:2480",
  username: "root",
  memoryDb: "claude_memory",
  autoIndex: true,
  capture: true,
  embed: true,
  extractor: "off"
};
var KEYS2 = {
  httpUri: "ARCADEDB_HTTP_URI",
  username: "ARCADEDB_USERNAME",
  password: "ARCADEDB_ROOT_PASSWORD",
  memoryDb: "ARCADEDB_MEMORY_DB",
  autoIndex: "ARCADEDB_AUTO_INDEX",
  capture: "ARCADEDB_CAPTURE",
  embed: "ARCADEDB_EMBED",
  extractor: "ARCADEDB_EXTRACTOR"
};
var DB_NAME = /^[a-z][a-z0-9_]*$/;
function envFilePath() {
  return join3(configDir(), ".env");
}
function readEnvFile(path = envFilePath()) {
  if (!existsSync3(path)) return {};
  const map = {};
  for (const line of readFileSync5(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    map[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return map;
}
function pick(key, processEnv, file, fallback) {
  const fromEnv = processEnv[key];
  if (fromEnv !== void 0 && fromEnv !== "") return { value: fromEnv, source: "env" };
  const fromFile = file[key];
  if (fromFile !== void 0 && fromFile !== "") return { value: fromFile, source: "file" };
  return { value: fallback, source: "default" };
}
function resolveConfig(opts = {}) {
  const envPath = opts.envPath ?? envFilePath();
  const processEnv = opts.processEnv ?? process.env;
  const file = readEnvFile(envPath);
  const httpUri = pick(KEYS2.httpUri, processEnv, file, DEFAULTS.httpUri);
  const username = pick(KEYS2.username, processEnv, file, DEFAULTS.username);
  const password = pick(KEYS2.password, processEnv, file, "");
  const memoryDb = pick(KEYS2.memoryDb, processEnv, file, DEFAULTS.memoryDb);
  if (!DB_NAME.test(memoryDb.value)) {
    memoryDb.value = DEFAULTS.memoryDb;
    memoryDb.source = "default";
  }
  const autoIndexRaw = pick(KEYS2.autoIndex, processEnv, file, DEFAULTS.autoIndex ? "on" : "off");
  const captureRaw = pick(KEYS2.capture, processEnv, file, DEFAULTS.capture ? "on" : "off");
  const embedRaw = pick(KEYS2.embed, processEnv, file, DEFAULTS.embed ? "on" : "off");
  const extractorRaw = pick(KEYS2.extractor, processEnv, file, DEFAULTS.extractor);
  const extractorMode = extractorRaw.value.toLowerCase();
  return {
    httpUri: httpUri.value.replace(/\/+$/, ""),
    username: username.value,
    password: password.value,
    memoryDb: memoryDb.value,
    autoIndex: autoIndexRaw.value.toLowerCase() !== "off",
    capture: captureRaw.value.toLowerCase() !== "off",
    embed: embedRaw.value.toLowerCase() !== "off",
    // "on" is accepted as an alias for live; anything unrecognised stays off so a typo cannot start spending tokens.
    extractor: extractorMode === "live" || extractorMode === "on" ? "live" : extractorMode === "dryrun" ? "dryrun" : "off",
    envPath,
    sources: {
      httpUri: httpUri.source,
      username: username.source,
      password: password.source,
      memoryDb: memoryDb.source,
      autoIndex: autoIndexRaw.source,
      capture: captureRaw.source,
      embed: embedRaw.source,
      extractor: extractorRaw.source
    }
  };
}
function toClientEnv(cfg) {
  return { httpUri: cfg.httpUri, username: cfg.username, password: cfg.password };
}

// src/project-map.ts
import { readFileSync as readFileSync6, existsSync as existsSync4, realpathSync } from "node:fs";
var DEFAULT_MAP = {
  version: 1,
  defaultMemoryDb: "claude_memory",
  projects: {}
};
function loadProjects(path, onError) {
  if (!existsSync4(path)) return { ...DEFAULT_MAP, projects: {} };
  const raw = readFileSync6(path, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    onError?.(new Error(`projects.json at ${path} is malformed (${err.message}); falling back to empty project map.`));
    return { ...DEFAULT_MAP, projects: {} };
  }
  if (!parsed.defaultMemoryDb) parsed.defaultMemoryDb = "claude_memory";
  if (!parsed.projects) parsed.projects = {};
  return parsed;
}

// src/memory-db.ts
function resolveMemoryDb(cfg, map) {
  return cfg.sources.memoryDb === "default" ? map.defaultMemoryDb : cfg.memoryDb;
}

// src/embed-spawn.ts
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { join as join5 } from "node:path";

// src/index-spawn.ts
import { createRequire } from "node:module";
import { basename, dirname as dirname4, join as join4 } from "node:path";
import { fileURLToPath } from "node:url";
function resolveRunner(here, pluginRoot, name = "index-runner") {
  if (pluginRoot) return join4(pluginRoot, "hooks", `${name}.js`);
  if (here.endsWith(".ts")) return join4(dirname4(here), `${name}.ts`);
  const dir = dirname4(here);
  if (basename(dir) === "src" && basename(dirname4(dir)) === "dist") {
    return join4(dir, "..", "..", "hooks", `${name}.js`);
  }
  return join4(dir, `${name}.js`);
}
function runnerPath(name = "index-runner") {
  return resolveRunner(fileURLToPath(import.meta.url), process.env["CLAUDE_PLUGIN_ROOT"] || void 0, name);
}
function runnerArgv(runner, args) {
  const argv = runner.endsWith(".ts") ? [createRequire(import.meta.url).resolve("tsx/cli"), runner] : [runner];
  argv.push(...args);
  return argv;
}

// src/embed-spawn.ts
function spawnEmbedRunner(args) {
  try {
    const runner = args.runner ?? runnerPath("embed-runner");
    const log = openSync(join5(configDir(), "embed.log"), "a");
    const argv = runnerArgv(runner, ["--db", args.db]);
    const child = spawn(process.execPath, argv, { detached: true, stdio: ["ignore", log, log], env: process.env });
    closeSync(log);
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  }
}

// src/embed.ts
import { existsSync as existsSync5, closeSync as closeSync2, openSync as openSync2, statSync, mkdirSync as mkdirSync4, writeFileSync as writeFileSync3, unlinkSync } from "node:fs";
import { join as join6 } from "node:path";
var INSTALL_STALE_MS = 30 * 60 * 1e3;
function embedDir() {
  return join6(configDir(), "embed");
}
function isEmbedInstalled(dir = embedDir()) {
  return existsSync5(join6(dir, "node_modules", "@xenova", "transformers", "package.json"));
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
var EXTRACT_IN_FLIGHT_MAX_MS = 10 * 60 * 1e3;
async function main() {
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
  const cfg = resolveConfig();
  const memoryDb = resolveMemoryDb(cfg, loadProjects(projectsJsonPath(), logError));
  if (cfg.capture && input.transcript_path && state.currentLine > state.lastCapturedLine) {
    await captureTurns(cfg, memoryDb, input, state);
  }
  if (cfg.extractor === "off") {
    logCapture("skip", { reason: "extractor_off", session: input.session_id, turn: state.currentTurnIdx });
    return;
  }
  maybeRequestExtraction(cfg, input, state);
}
async function captureTurns(cfg, memoryDb, input, state) {
  const turns = parseTranscriptTurns(input.transcript_path, state.lastCapturedLine + 1, state.currentLine);
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
    logError(err);
    logCapture("turns_capture_failed", { session: input.session_id, db: memoryDb, error: err?.message ?? String(err) });
  }
}
function maybeRequestExtraction(cfg, input, state) {
  const now = /* @__PURE__ */ new Date();
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
  const cliPath = root ? join7(root, "hooks", "cli.js") : join7(dirname5(fileURLToPath2(import.meta.url)), "cli.js");
  const cli = `node ${cliPath}`;
  markExtractInFlight(state.claudeCodeSessionId, now);
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
- mode: ${cfg.extractor}
Do not skip this. After the subagent reports back, resume the conversation.`
  }) + "\n");
}
function logError(err) {
  try {
    const path = hookErrorLogPath();
    if (!existsSync6(dirname5(path))) mkdirSync5(dirname5(path), { recursive: true });
    appendFileSync2(path, `[${(/* @__PURE__ */ new Date()).toISOString()}] stop: ${err?.message ?? String(err)}
`);
  } catch {
  }
}
main().catch((err) => {
  logError(err);
  process.exit(0);
});
export {
  EXTRACT_IN_FLIGHT_MAX_MS
};
