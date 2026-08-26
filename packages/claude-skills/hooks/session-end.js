#!/usr/bin/env node

// src/session-end.ts
import { appendFileSync, existsSync as existsSync4, mkdirSync as mkdirSync2 } from "node:fs";
import { dirname } from "node:path";

// ../agent-memory/dist/src/errors.js
var ArcadeDBConnectionError = class extends Error {
  uri;
  cause;
  constructor(uri, cause) {
    super(`Could not reach ArcadeDB at ${uri}. Is the container running? Try \`docker ps\`.`);
    this.uri = uri;
    this.cause = cause;
    this.name = "ArcadeDBConnectionError";
  }
};
var DatabaseNotFoundError = class extends Error {
  database;
  constructor(database) {
    super(`Database "${database}" does not exist. Run \`arcadedb-memory migrate ${database}\` to create it.`);
    this.database = database;
    this.name = "DatabaseNotFoundError";
  }
};

// ../agent-memory/dist/src/client.js
var Client = class {
  env;
  constructor(env) {
    this.env = env;
  }
  authHeader() {
    return "Basic " + Buffer.from(`${this.env.username}:${this.env.password}`).toString("base64");
  }
  async post(path, body) {
    let res;
    try {
      res = await fetch(`${this.env.httpUri}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: this.authHeader() },
        body: JSON.stringify(body)
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
        headers: { Authorization: this.authHeader() }
      });
    } catch (cause) {
      throw new ArcadeDBConnectionError(this.env.httpUri, cause);
    }
    if (!res.ok)
      throw new Error(`ArcadeDB ${res.status} ${res.statusText}`);
    const data = await res.json();
    return data.result;
  }
};

// ../agent-memory/dist/src/env.js
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
var DEFAULT_PATH = join(homedir(), ".config", "arcadedb", ".env");
function loadEnv(path = DEFAULT_PATH) {
  if (!existsSync(path)) {
    throw new Error(`Env file not found at ${path}. Create it with ARCADEDB_ROOT_PASSWORD=<your-password>.`);
  }
  const raw = readFileSync(path, "utf8");
  const map = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#"))
      continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1)
      continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    map[key] = value;
  }
  const password = map["ARCADEDB_ROOT_PASSWORD"];
  if (!password) {
    throw new Error(`ARCADEDB_ROOT_PASSWORD missing in ${path}.`);
  }
  return {
    password,
    httpUri: map["ARCADEDB_HTTP_URI"] ?? "http://localhost:2480",
    username: map["ARCADEDB_USERNAME"] ?? "root"
  };
}

// ../agent-memory/dist/src/memory/sessions.js
async function endSession(client, db, id, summary) {
  const summaryClause = summary ? `, s.summary = ${cypherStr(summary)}` : "";
  await client.execute(db, "cypher", `MATCH (s:Session {id: ${cypherStr(id)}}) SET s.endedAt = datetime(${cypherStr((/* @__PURE__ */ new Date()).toISOString())})${summaryClause}`);
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

// src/project-map.ts
import { readFileSync as readFileSync2, existsSync as existsSync2 } from "node:fs";
var DEFAULT_MAP = {
  version: 1,
  defaultMemoryDb: "claude_memory",
  projects: {}
};
function loadProjects(path, onError) {
  if (!existsSync2(path)) return { ...DEFAULT_MAP, projects: {} };
  const raw = readFileSync2(path, "utf8");
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

// src/session-state.ts
import { existsSync as existsSync3, mkdirSync, readFileSync as readFileSync3, writeFileSync } from "node:fs";
function readSessionState(claudeCodeSessionId) {
  const path = sessionStatePath(claudeCodeSessionId);
  if (!existsSync3(path)) return null;
  try {
    const raw = JSON.parse(readFileSync3(path, "utf8"));
    return {
      ...raw,
      currentLine: raw.currentLine ?? 0,
      lastExtractedLine: raw.lastExtractedLine ?? 0
    };
  } catch {
    return null;
  }
}

// src/hook-input.ts
import { readFileSync as readFileSync4 } from "node:fs";
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
    return parseHookInput(readFileSync4(0, "utf8"));
  } catch {
    return {};
  }
}

// src/session-end.ts
async function main() {
  const input = readHookInput();
  const claudeCodeSessionId = input.session_id ?? process.env["CLAUDE_SESSION_ID"];
  if (!claudeCodeSessionId) return;
  const state = readSessionState(claudeCodeSessionId);
  if (!state) return;
  const map = loadProjects(projectsJsonPath(), logError);
  const env = loadEnv();
  const client = new Client(env);
  await endSession(client, map.defaultMemoryDb, state.sessionDbId);
}
function logError(err) {
  try {
    const path = hookErrorLogPath();
    if (!existsSync4(dirname(path))) mkdirSync2(dirname(path), { recursive: true });
    appendFileSync(path, `[${(/* @__PURE__ */ new Date()).toISOString()}] session-end: ${err?.message ?? String(err)}
`);
  } catch {
  }
}
main().catch((err) => {
  logError(err);
  process.exit(0);
});
