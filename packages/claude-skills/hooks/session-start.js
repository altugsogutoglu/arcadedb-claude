#!/usr/bin/env node

// src/session-start.ts
import { appendFileSync as appendFileSync2, existsSync as existsSync6, mkdirSync as mkdirSync4 } from "node:fs";
import { dirname as dirname4 } from "node:path";
import { execSync as execSync2 } from "node:child_process";
import { randomUUID as randomUUID2 } from "node:crypto";

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

// ../agent-memory/dist/src/schemas/core.js
var coreSchema = {
  name: "core",
  vertices: [
    {
      name: "Repo",
      properties: [
        { name: "name", type: "STRING", primaryKey: true, notNull: true },
        { name: "path", type: "STRING" },
        { name: "stack", type: "STRING" },
        { name: "lastIndexedAt", type: "DATETIME" }
      ]
    },
    {
      name: "Person",
      properties: [
        { name: "name", type: "STRING", primaryKey: true, notNull: true },
        { name: "email", type: "STRING" },
        { name: "role", type: "STRING" }
      ]
    }
  ],
  edges: []
};

// ../agent-memory/dist/src/schemas/memory.js
var memorySchema = {
  name: "memory",
  vertices: [
    {
      name: "Session",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "startedAt", type: "DATETIME", notNull: true },
        { name: "endedAt", type: "DATETIME" },
        { name: "repo", type: "STRING" },
        { name: "summary", type: "STRING" }
      ]
    },
    {
      name: "Decision",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "summary", type: "STRING", notNull: true },
        { name: "rationale", type: "STRING" },
        { name: "decidedAt", type: "DATETIME", notNull: true },
        { name: "repo", type: "STRING" }
      ]
    },
    {
      name: "Insight",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "topic", type: "STRING", notNull: true },
        { name: "text", type: "STRING", notNull: true },
        { name: "createdAt", type: "DATETIME", notNull: true },
        { name: "repo", type: "STRING" }
      ]
    },
    {
      name: "Question",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "text", type: "STRING", notNull: true },
        { name: "askedAt", type: "DATETIME", notNull: true },
        { name: "repo", type: "STRING" }
      ]
    },
    {
      name: "Answer",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "text", type: "STRING", notNull: true },
        { name: "answeredAt", type: "DATETIME", notNull: true },
        { name: "confidence", type: "FLOAT" }
      ]
    }
  ],
  edges: [
    { name: "ABOUT" },
    { name: "DURING" },
    { name: "FOLLOWS" },
    { name: "ANSWERS" },
    { name: "SUPERSEDES" },
    { name: "DECIDED_ON" },
    { name: "BLOCKED_BY" },
    { name: "FIXED" },
    { name: "RECOMMENDED_AGAINST" }
  ]
};

// ../agent-memory/dist/src/schemas/code.js
var codeSchema = {
  name: "code",
  vertices: [
    {
      name: "Module",
      properties: [
        { name: "name", type: "STRING", notNull: true },
        { name: "path", type: "STRING", primaryKey: true, notNull: true },
        { name: "language", type: "STRING" }
      ]
    },
    {
      name: "File",
      properties: [
        { name: "path", type: "STRING", primaryKey: true, notNull: true },
        { name: "language", type: "STRING" },
        { name: "loc", type: "INTEGER" },
        { name: "hash", type: "STRING" },
        { name: "modifiedAt", type: "DATETIME" }
      ]
    },
    {
      name: "Class",
      properties: [
        { name: "name", type: "STRING", notNull: true },
        { name: "kind", type: "STRING" },
        { name: "exported", type: "BOOLEAN" }
      ]
    },
    {
      name: "Function",
      properties: [
        { name: "name", type: "STRING", notNull: true },
        { name: "signature", type: "STRING" },
        { name: "async", type: "BOOLEAN" },
        { name: "exported", type: "BOOLEAN" },
        { name: "kind", type: "STRING" }
      ]
    },
    {
      name: "Route",
      properties: [
        { name: "path", type: "STRING", notNull: true },
        { name: "method", type: "STRING" },
        { name: "framework", type: "STRING" }
      ]
    },
    {
      name: "Component",
      properties: [
        { name: "name", type: "STRING", notNull: true },
        { name: "path", type: "STRING" },
        { name: "kind", type: "STRING" }
      ]
    }
  ],
  edges: [
    { name: "CONTAINS" },
    { name: "IMPORTS" },
    { name: "CALLS" },
    { name: "EXTENDS" },
    { name: "IMPLEMENTS" },
    { name: "HANDLES" },
    { name: "RENDERS" }
  ]
};

// ../agent-memory/dist/src/schemas/business.js
var businessSchema = {
  name: "business",
  vertices: [
    { name: "Store", properties: [{ name: "name", type: "STRING", primaryKey: true, notNull: true }] },
    { name: "Product", properties: [
      { name: "sku", type: "STRING", primaryKey: true, notNull: true },
      { name: "name", type: "STRING" },
      { name: "priceIncVat", type: "FLOAT" }
    ] },
    { name: "Category", properties: [{ name: "name", type: "STRING", primaryKey: true, notNull: true }] },
    { name: "Order", properties: [
      { name: "id", type: "STRING", primaryKey: true, notNull: true },
      { name: "placedAt", type: "DATETIME" }
    ] },
    { name: "Customer", properties: [
      { name: "id", type: "STRING", primaryKey: true, notNull: true },
      { name: "email", type: "STRING" }
    ] },
    { name: "Concept", properties: [{ name: "name", type: "STRING", primaryKey: true, notNull: true }] }
  ],
  edges: [
    { name: "SELLS" },
    { name: "BELONGS_TO" },
    { name: "PLACED" },
    { name: "CONTAINS_PRODUCT" }
  ]
};

// ../agent-memory/dist/src/schemas/notes.js
var notesSchema = {
  name: "notes",
  vertices: [
    {
      name: "Note",
      properties: [
        { name: "path", type: "STRING", primaryKey: true, notNull: true },
        { name: "title", type: "STRING" },
        { name: "content", type: "STRING" },
        { name: "vault", type: "STRING" },
        { name: "createdAt", type: "DATETIME" },
        { name: "modifiedAt", type: "DATETIME" }
      ]
    },
    {
      name: "Tag",
      properties: [
        { name: "name", type: "STRING", notNull: true },
        { name: "vault", type: "STRING" }
      ]
    }
  ],
  edges: [
    { name: "LINKS_TO" },
    { name: "TAGGED" },
    { name: "MENTIONS" }
  ]
};

// ../agent-memory/dist/src/schemas/all.js
var allSchemas = {
  core: coreSchema,
  memory: memorySchema,
  code: codeSchema,
  business: businessSchema,
  notes: notesSchema
};

// ../agent-memory/dist/src/migrations/render.js
function renderSchema(s) {
  const out = [];
  for (const v of s.vertices)
    out.push(...renderVertex(v));
  for (const e of s.edges)
    out.push(...renderEdge(e));
  return out;
}
function renderVertex(v) {
  const stmts = [`CREATE VERTEX TYPE ${v.name} IF NOT EXISTS`];
  for (const p of v.properties ?? []) {
    stmts.push(...renderProperty(v.name, p));
  }
  return stmts;
}
function renderEdge(e) {
  const stmts = [`CREATE EDGE TYPE ${e.name} IF NOT EXISTS`];
  for (const p of e.properties ?? []) {
    stmts.push(...renderProperty(e.name, p));
  }
  return stmts;
}
function renderProperty(typeName, p) {
  const stmts = [`CREATE PROPERTY ${typeName}.${p.name} IF NOT EXISTS ${p.type}`];
  if (p.primaryKey) {
    stmts.push(`CREATE INDEX IF NOT EXISTS ON ${typeName}(${p.name}) UNIQUE`);
  }
  return stmts;
}

// ../agent-memory/dist/src/migrations/apply.js
async function applySchemas(client, database, domains) {
  await ensureDatabase(client, database);
  const selected = domains ?? Object.keys(allSchemas);
  for (const domain of selected) {
    const schema = allSchemas[domain];
    if (!schema)
      throw new Error(`Unknown schema domain: ${domain}`);
    const stmts = renderSchema(schema);
    for (const stmt of stmts) {
      await client.execute(database, "sql", stmt);
    }
  }
}
async function ensureDatabase(client, database) {
  const existing = await client.listDatabases();
  if (existing.includes(database))
    return;
  await client.command(`create database ${database}`);
}

// ../agent-memory/dist/src/memory/sessions.js
import { randomUUID } from "node:crypto";
async function startSession(client, db, input = {}) {
  const id = randomUUID();
  const repoClause = input.repo ? `, repo: ${cypherStr(input.repo)}` : "";
  await client.execute(db, "cypher", `CREATE (s:Session { id: ${cypherStr(id)}, startedAt: datetime(${cypherStr((/* @__PURE__ */ new Date()).toISOString())})${repoClause} })`);
  return id;
}
async function findLatestSessionForRepo(client, db, repo, excludeId) {
  const excludeClause = excludeId ? ` AND s.id <> ${cypherStr(excludeId)}` : "";
  const rows = await client.query(db, "cypher", `MATCH (s:Session) WHERE s.repo = ${cypherStr(repo)}${excludeClause}
     RETURN s.id ORDER BY s.startedAt DESC LIMIT 1`);
  return rows[0]?.["s.id"] ?? null;
}
function cypherStr(s) {
  return `'${s.replace(/'/g, "\\'")}'`;
}
async function linkFollows(client, db, laterSessionId, earlierSessionId) {
  const cypher = `
    MATCH (later:Session {id: ${cypherStr(laterSessionId)}}),
          (earlier:Session {id: ${cypherStr(earlierSessionId)}})
    MERGE (later)-[:FOLLOWS]->(earlier)
  `;
  await client.execute(db, "cypher", cypher);
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
import { readFileSync as readFileSync2, existsSync as existsSync2 } from "node:fs";
import { basename } from "node:path";
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
function findProject(map, cwd, gitRemoteUrl) {
  for (const [key, entry] of Object.entries(map.projects)) {
    if (entry.path === cwd) return { key, entry };
  }
  const base = basename(cwd);
  if (map.projects[base]) return { key: base, entry: map.projects[base] };
  if (gitRemoteUrl) {
    const remoteName = extractRemoteName(gitRemoteUrl);
    if (remoteName && map.projects[remoteName]) {
      return { key: remoteName, entry: map.projects[remoteName] };
    }
  }
  return null;
}
function extractRemoteName(url) {
  const m = url.match(/[/:]([\w.-]+?)(?:\.git)?\s*$/);
  return m?.[1] ?? null;
}

// src/auto-register.ts
import { existsSync as existsSync3, mkdirSync, readFileSync as readFileSync3, renameSync, writeFileSync } from "node:fs";
import { basename as basename2, dirname, join as join3 } from "node:path";
import { execSync } from "node:child_process";
function deriveProjectIdentity(cwd, gitRemoteUrl) {
  const key = (gitRemoteUrl ? extractRemoteName(gitRemoteUrl) : null) ?? basename2(cwd);
  return { key, db: toDbName(key) };
}
function toDbName(key) {
  const sanitized = key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[0-9]/.test(sanitized) ? `p_${sanitized}` : sanitized;
}
var NEXT_CONFIGS = ["next.config.js", "next.config.mjs", "next.config.ts"];
var EXPO_CONFIGS = ["app.json", "app.config.js", "app.config.ts"];
function detectStack(cwd) {
  const stack = [];
  const has = (name) => existsSync3(join3(cwd, name));
  if (has("composer.json")) stack.push("laravel");
  const isNext = NEXT_CONFIGS.some(has);
  if (isNext) stack.push("nextjs");
  const isExpo = EXPO_CONFIGS.some((name) => has(name) && fileMentionsExpo(join3(cwd, name)));
  if (isExpo) stack.push("expo");
  const isTs = has("tsconfig.json");
  if (isTs) stack.push("typescript");
  if (has("package.json") && !isNext && !isExpo && !isTs) stack.push("javascript");
  if (has("pyproject.toml") || has("requirements.txt")) stack.push("python");
  return stack;
}
function fileMentionsExpo(path) {
  try {
    return /["']?\bexpo\b["']?\s*:/.test(readFileSync3(path, "utf8"));
  } catch {
    return false;
  }
}
var MEMORY_DB_COLLISION = "db_collides_with_memory_db";
var RegistrationError = class extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
    this.name = "RegistrationError";
  }
  reason;
};
function registerProject(projectsPath, key, entry) {
  const map = loadProjects(projectsPath, (err) => {
    throw err;
  });
  const existing = map.projects[key];
  if (existing) return { entry: existing, created: false };
  if (entry.db === map.defaultMemoryDb) throw new RegistrationError(MEMORY_DB_COLLISION);
  map.projects[key] = entry;
  const dir = dirname(projectsPath);
  if (!existsSync3(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${projectsPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(map, null, 2) + "\n");
  renameSync(tmp, projectsPath);
  return { entry, created: true };
}
function gitToplevel(cwd) {
  try {
    const out = execSync("git rev-parse --show-toplevel", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() || null;
  } catch {
    return null;
  }
}

// src/context-builder.ts
function buildContext(input) {
  const lines = ["ArcadeDB context loaded:"];
  if (input.project) {
    const p = input.project;
    if (p.autoRegistered && p.lastIndexed === null) {
      lines.push(
        `  Project: ${p.name} (DB: ${p.db}, auto-registered, not indexed yet, run /graph-index to index code)`
      );
    } else {
      const indexed = p.lastIndexed ?? "not indexed yet";
      lines.push(
        `  Project: ${p.name} (DB: ${p.db}, indexed: ${indexed}, ${p.fileCount} files, ${p.importCount} imports)`
      );
    }
    if (p.types.length > 0) {
      lines.push(`  Schema: ${p.types.join(", ")}`);
    }
  }
  lines.push(
    `  Memory DB: ${input.memory.db} (${input.memory.decisionCount} decisions, ${input.memory.insightCount} insights)`
  );
  lines.push(extractorLine(input.extractorMode));
  return lines.join("\n");
}
function extractorLine(extractorMode) {
  const mode = (extractorMode ?? "live").toLowerCase();
  return mode === "off" ? "  LLM extractor: off (set ARCADEDB_EXTRACTOR=live or dryrun to capture)" : mode === "dryrun" ? "  LLM extractor: dryrun (JSONL audit only; set ARCADEDB_EXTRACTOR=live to write the graph)" : "  LLM extractor: live (capturing decisions/insights/Q&A into claude_memory; ARCADEDB_EXTRACTOR=off to disable)";
}

// src/session-state.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync2, readFileSync as readFileSync4, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname as dirname2 } from "node:path";
function readSessionState(claudeCodeSessionId) {
  const path = sessionStatePath(claudeCodeSessionId);
  if (!existsSync4(path)) return null;
  try {
    const raw = JSON.parse(readFileSync4(path, "utf8"));
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
  const dir = dirname2(path);
  if (!existsSync4(dir)) mkdirSync2(dir, { recursive: true });
  writeFileSync2(path, JSON.stringify(state, null, 2) + "\n");
}

// src/hook-input.ts
import { readFileSync as readFileSync5 } from "node:fs";
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
    return parseHookInput(readFileSync5(0, "utf8"));
  } catch {
    return {};
  }
}

// src/transcript-lines.ts
import { readFileSync as readFileSync6 } from "node:fs";
function countTranscriptLines(path) {
  if (!path) return 0;
  let buf;
  try {
    buf = readFileSync6(path);
  } catch {
    return 0;
  }
  if (buf.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++;
  if (buf[buf.length - 1] !== 10) n++;
  return n;
}

// src/capture-log.ts
import { appendFileSync, existsSync as existsSync5, mkdirSync as mkdirSync3 } from "node:fs";
import { dirname as dirname3 } from "node:path";
function logCapture(event, fields = {}) {
  try {
    const path = captureLogPath();
    if (!existsSync5(dirname3(path))) mkdirSync3(dirname3(path), { recursive: true });
    appendFileSync(path, JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), event, ...fields }) + "\n");
  } catch {
  }
}

// src/session-start.ts
async function main() {
  const input = readHookInput();
  const cwd = input.cwd ?? process.env["PWD"] ?? process.cwd();
  const remote = safeGitRemote(cwd);
  const map = loadProjects(projectsJsonPath(), logError);
  const match = findProject(map, cwd, remote);
  const env = loadEnv();
  const client = new Client(env);
  let project = match;
  let autoRegistered = false;
  const toplevel = match ? null : gitToplevel(cwd);
  if (toplevel) {
    const identity = deriveProjectIdentity(toplevel, remote);
    try {
      const stored = map.projects[identity.key];
      if (stored) {
        project = { key: identity.key, entry: stored };
      } else {
        if (identity.db === map.defaultMemoryDb) throw new RegistrationError(MEMORY_DB_COLLISION);
        const entry = {
          db: identity.db,
          path: toplevel,
          stack: detectStack(toplevel),
          indexLevel: 0,
          lastIndexed: null
        };
        await applySchemas(client, identity.db, ["core", "code"]);
        const result = registerProject(projectsJsonPath(), identity.key, entry);
        if (result.created) {
          logCapture("project_registered", { key: identity.key, db: result.entry.db, path: toplevel, cwd });
        }
        project = { key: identity.key, entry: result.entry };
        autoRegistered = result.created;
      }
    } catch (err) {
      logError(err);
      logCapture("project_register_failed", {
        key: identity.key,
        reason: err instanceof RegistrationError ? err.reason : void 0,
        error: err?.message ?? String(err)
      });
      project = null;
    }
  }
  let projectCtx = null;
  if (project) {
    projectCtx = await probeProject(client, project.entry.db, project.key, project.entry.lastIndexed);
    if (autoRegistered) projectCtx.autoRegistered = true;
  }
  const memoryCtx = await probeMemory(client, map.defaultMemoryDb);
  process.stdout.write(buildContext({ project: projectCtx, memory: memoryCtx, extractorMode: process.env["ARCADEDB_EXTRACTOR"] }) + "\n");
  if (project) {
    const claudeCodeSessionId = input.session_id ?? process.env["CLAUDE_SESSION_ID"] ?? `local-${randomUUID2()}`;
    await tryStartSession(client, map.defaultMemoryDb, project.key, cwd, claudeCodeSessionId, input.transcript_path).catch((err) => logError(err));
  }
}
async function tryStartSession(client, memoryDb, repo, cwd, claudeCodeSessionId, transcriptPath) {
  if (readSessionState(claudeCodeSessionId)) {
    logCapture("session_resumed", { session: claudeCodeSessionId });
    return;
  }
  const userName = resolveUserName(cwd);
  const previousSessionId = await findLatestSessionForRepo(client, memoryDb, repo);
  const newSessionId = await startSession(client, memoryDb, { repo });
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const seedLine = countTranscriptLines(transcriptPath);
  writeSessionState({
    claudeCodeSessionId,
    sessionDbId: newSessionId,
    repo,
    cwd,
    userName,
    startedAt: now,
    currentTurnIdx: 0,
    lastExtractedTurnIdx: 0,
    lastExtractedAt: now,
    currentLine: seedLine,
    lastExtractedLine: seedLine
  });
  if (previousSessionId) {
    await linkFollows(client, memoryDb, newSessionId, previousSessionId);
  }
}
function resolveUserName(cwd) {
  try {
    const out = execSync2("git config user.name", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const trimmed = out.trim();
    if (trimmed) return trimmed;
  } catch {
  }
  return process.env["ARCADEDB_USER_NAME"] ?? process.env["USER"] ?? "unknown";
}
async function probeProject(client, db, name, lastIndexed) {
  const fileRows = await client.query(db, "cypher", "MATCH (f:File) RETURN count(f) AS count").catch(() => [{ count: 0 }]);
  const importRows = await client.query(db, "cypher", "MATCH ()-[r:IMPORTS]->() RETURN count(r) AS count").catch(() => [{ count: 0 }]);
  const typeRows = await client.query(db, "sql", "SELECT name FROM schema:types").catch(() => []);
  return {
    name,
    db,
    lastIndexed,
    fileCount: fileRows[0]?.count ?? 0,
    importCount: importRows[0]?.count ?? 0,
    types: typeRows.map((r) => r.name)
  };
}
async function probeMemory(client, db) {
  const decisionRows = await client.query(db, "cypher", "MATCH (d:Decision) RETURN count(d) AS count").catch(() => [{ count: 0 }]);
  const insightRows = await client.query(db, "cypher", "MATCH (i:Insight) RETURN count(i) AS count").catch(() => [{ count: 0 }]);
  return {
    db,
    decisionCount: decisionRows[0]?.count ?? 0,
    insightCount: insightRows[0]?.count ?? 0
  };
}
function safeGitRemote(cwd) {
  try {
    const out = execSync2("git remote get-url origin", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() || null;
  } catch {
    return null;
  }
}
function logError(err) {
  try {
    const path = hookErrorLogPath();
    if (!existsSync6(dirname4(path))) mkdirSync4(dirname4(path), { recursive: true });
    appendFileSync2(path, `[${(/* @__PURE__ */ new Date()).toISOString()}] session-start: ${err?.message ?? String(err)}
`);
  } catch {
  }
}
main().catch((err) => {
  logError(err);
  process.exit(0);
});
