#!/usr/bin/env node

// src/session-end.ts
import { appendFileSync as appendFileSync2, existsSync as existsSync5, mkdirSync as mkdirSync4 } from "node:fs";
import { dirname as dirname4 } from "node:path";

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

// src/agent-memory/memory/sessions.ts
async function endSession(client, db, id, summary) {
  const summaryClause = summary ? `, s.summary = ${cypherStr(summary)}` : "";
  await client.execute(
    db,
    "cypher",
    `MATCH (s:Session {id: ${cypherStr(id)}}) SET s.endedAt = datetime(${cypherStr((/* @__PURE__ */ new Date()).toISOString())})${summaryClause}`
  );
}
function cypherStr(s) {
  return `'${s.replace(/'/g, "\\'")}'`;
}

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

// src/project-map.ts
import { readFileSync, existsSync, realpathSync } from "node:fs";
var DEFAULT_MAP = {
  version: 1,
  defaultMemoryDb: "claude_memory",
  projects: {}
};
function loadProjects(path, onError) {
  if (!existsSync(path)) return { ...DEFAULT_MAP, projects: {} };
  const raw = readFileSync(path, "utf8");
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

// src/config.ts
import { existsSync as existsSync2, mkdirSync, readFileSync as readFileSync2, writeFileSync, renameSync, chmodSync } from "node:fs";
import { dirname, join as join3 } from "node:path";
var DEFAULTS = {
  httpUri: "http://localhost:2480",
  username: "root",
  memoryDb: "claude_memory",
  autoIndex: true,
  capture: true,
  embed: true,
  extractor: "off",
  rollup: true,
  rollupModel: "haiku",
  rollupTransport: "claude"
};
var KEYS = {
  httpUri: "ARCADEDB_HTTP_URI",
  username: "ARCADEDB_USERNAME",
  password: "ARCADEDB_ROOT_PASSWORD",
  memoryDb: "ARCADEDB_MEMORY_DB",
  autoIndex: "ARCADEDB_AUTO_INDEX",
  capture: "ARCADEDB_CAPTURE",
  embed: "ARCADEDB_EMBED",
  extractor: "ARCADEDB_EXTRACTOR",
  rollup: "ARCADEDB_ROLLUP",
  rollupModel: "ARCADEDB_ROLLUP_MODEL",
  rollupTransport: "ARCADEDB_ROLLUP_TRANSPORT"
};
var DB_NAME = /^[a-z][a-z0-9_]*$/;
function envFilePath() {
  return join3(configDir(), ".env");
}
function readEnvFile(path = envFilePath()) {
  if (!existsSync2(path)) return {};
  const map = {};
  for (const line of readFileSync2(path, "utf8").split("\n")) {
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
  const httpUri = pick(KEYS.httpUri, processEnv, file, DEFAULTS.httpUri);
  const username = pick(KEYS.username, processEnv, file, DEFAULTS.username);
  const password = pick(KEYS.password, processEnv, file, "");
  const memoryDb = pick(KEYS.memoryDb, processEnv, file, DEFAULTS.memoryDb);
  if (!DB_NAME.test(memoryDb.value)) {
    memoryDb.value = DEFAULTS.memoryDb;
    memoryDb.source = "default";
  }
  const autoIndexRaw = pick(KEYS.autoIndex, processEnv, file, DEFAULTS.autoIndex ? "on" : "off");
  const captureRaw = pick(KEYS.capture, processEnv, file, DEFAULTS.capture ? "on" : "off");
  const embedRaw = pick(KEYS.embed, processEnv, file, DEFAULTS.embed ? "on" : "off");
  const extractorRaw = pick(KEYS.extractor, processEnv, file, DEFAULTS.extractor);
  const extractorMode = extractorRaw.value.toLowerCase();
  const rollupRaw = pick(KEYS.rollup, processEnv, file, DEFAULTS.rollup ? "on" : "off");
  const rollupModelRaw = pick(KEYS.rollupModel, processEnv, file, DEFAULTS.rollupModel);
  const rollupTransportRaw = pick(KEYS.rollupTransport, processEnv, file, DEFAULTS.rollupTransport);
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
    rollup: rollupRaw.value.toLowerCase() !== "off",
    rollupModel: rollupModelRaw.value,
    rollupTransport: rollupTransportRaw.value.toLowerCase() === "api" ? "api" : "claude",
    envPath,
    sources: {
      httpUri: httpUri.source,
      username: username.source,
      password: password.source,
      memoryDb: memoryDb.source,
      autoIndex: autoIndexRaw.source,
      capture: captureRaw.source,
      embed: embedRaw.source,
      extractor: extractorRaw.source,
      rollup: rollupRaw.source,
      rollupModel: rollupModelRaw.source,
      rollupTransport: rollupTransportRaw.source
    }
  };
}
function toClientEnv(cfg) {
  return { httpUri: cfg.httpUri, username: cfg.username, password: cfg.password };
}

// src/memory-db.ts
function resolveMemoryDb(cfg, map) {
  return cfg.sources.memoryDb === "default" ? map.defaultMemoryDb : cfg.memoryDb;
}

// src/session-state.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync2, readFileSync as readFileSync3, writeFileSync as writeFileSync2 } from "node:fs";
function readSessionState(claudeCodeSessionId) {
  const path = sessionStatePath(claudeCodeSessionId);
  if (!existsSync3(path)) return null;
  try {
    const raw = JSON.parse(readFileSync3(path, "utf8"));
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

// src/hook-input.ts
import { readFileSync as readFileSync4 } from "node:fs";
var KEYS2 = [
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
  for (const k of KEYS2) {
    const v = obj[k];
    if (v !== void 0) out[k] = v;
  }
  return out;
}
function readHookInput() {
  try {
    return parseHookInput(readFileSync4(0, "utf8"));
  } catch {
    return {};
  }
}
function hooksDisabled(env = process.env) {
  return (env["ARCADEDB_HOOKS"] ?? "").toLowerCase() === "off";
}

// src/rollup-spawn.ts
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { join as join5 } from "node:path";

// src/index-spawn.ts
import { createRequire } from "node:module";
import { basename, dirname as dirname2, join as join4 } from "node:path";
import { fileURLToPath } from "node:url";
function resolveRunner(here, pluginRoot, name = "index-runner") {
  if (pluginRoot) return join4(pluginRoot, "hooks", `${name}.js`);
  if (here.endsWith(".ts")) return join4(dirname2(here), `${name}.ts`);
  const dir = dirname2(here);
  if (basename(dir) === "src" && basename(dirname2(dir)) === "dist") {
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

// src/rollup-spawn.ts
function spawnRollupRunner(args) {
  try {
    const runner = args.runner ?? runnerPath("rollup-runner");
    const log = openSync(join5(configDir(), "rollup.log"), "a");
    const argv = runnerArgv(runner, ["--db", args.db]);
    const child = spawn(process.execPath, argv, { detached: true, stdio: ["ignore", log, log], env: process.env });
    closeSync(log);
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  }
}

// src/capture-log.ts
import { appendFileSync, existsSync as existsSync4, mkdirSync as mkdirSync3 } from "node:fs";
import { dirname as dirname3 } from "node:path";
function logCapture(event, fields = {}) {
  try {
    const path = captureLogPath();
    if (!existsSync4(dirname3(path))) mkdirSync3(dirname3(path), { recursive: true });
    appendFileSync(path, JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), event, ...fields }) + "\n");
  } catch {
  }
}

// src/session-end.ts
async function main() {
  if (hooksDisabled()) return;
  const input = readHookInput();
  const claudeCodeSessionId = input.session_id ?? process.env["CLAUDE_SESSION_ID"];
  if (!claudeCodeSessionId) return;
  const state = readSessionState(claudeCodeSessionId);
  if (!state) return;
  const map = loadProjects(projectsJsonPath(), logError);
  const cfg = resolveConfig();
  const client = new Client(toClientEnv(cfg));
  const memoryDb = resolveMemoryDb(cfg, map);
  await endSession(client, memoryDb, state.sessionDbId);
  if (cfg.rollup) {
    const pid = spawnRollupRunner({ db: memoryDb });
    if (pid) logCapture("rollup_spawned", { db: memoryDb, pid, session: state.sessionDbId });
  }
}
function logError(err) {
  try {
    const path = hookErrorLogPath();
    if (!existsSync5(dirname4(path))) mkdirSync4(dirname4(path), { recursive: true });
    appendFileSync2(path, `[${(/* @__PURE__ */ new Date()).toISOString()}] session-end: ${err?.message ?? String(err)}
`);
  } catch {
  }
}
main().catch((err) => {
  logError(err);
  process.exit(0);
});
