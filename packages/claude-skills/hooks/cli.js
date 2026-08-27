#!/usr/bin/env node

// bin/arcadedb-skills.ts
import { readFileSync as readFileSync7, writeFileSync as writeFileSync5, mkdirSync as mkdirSync7, existsSync as existsSync9 } from "node:fs";
import { dirname as dirname7 } from "node:path";

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

// src/agent-memory/schemas/core.ts
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

// src/agent-memory/schemas/memory.ts
var EMBEDDING_DIMENSIONS = 384;
var EMBEDDED_TYPES = ["Turn", "Decision", "Insight", "Question", "Answer"];
var embedding = {
  name: "embedding",
  type: "ARRAY_OF_FLOATS",
  vectorIndex: { dimensions: EMBEDDING_DIMENSIONS, similarity: "COSINE" }
};
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
      name: "Turn",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "sessionId", type: "STRING", notNull: true },
        { name: "idx", type: "INTEGER", notNull: true },
        { name: "role", type: "STRING", notNull: true },
        { name: "text", type: "STRING", notNull: true },
        { name: "ts", type: "DATETIME", notNull: true },
        { name: "repo", type: "STRING" },
        embedding
      ]
    },
    {
      name: "Decision",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "summary", type: "STRING", notNull: true },
        { name: "rationale", type: "STRING" },
        { name: "decidedAt", type: "DATETIME", notNull: true },
        { name: "repo", type: "STRING" },
        embedding
      ]
    },
    {
      name: "Insight",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "topic", type: "STRING", notNull: true },
        { name: "text", type: "STRING", notNull: true },
        { name: "createdAt", type: "DATETIME", notNull: true },
        { name: "repo", type: "STRING" },
        embedding
      ]
    },
    {
      name: "Question",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "text", type: "STRING", notNull: true },
        { name: "askedAt", type: "DATETIME", notNull: true },
        { name: "repo", type: "STRING" },
        embedding
      ]
    },
    {
      name: "Answer",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "text", type: "STRING", notNull: true },
        { name: "answeredAt", type: "DATETIME", notNull: true },
        { name: "confidence", type: "FLOAT" },
        embedding
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

// src/agent-memory/schemas/code.ts
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

// src/agent-memory/schemas/business.ts
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

// src/agent-memory/schemas/notes.ts
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

// src/agent-memory/schemas/all.ts
var allSchemas = {
  core: coreSchema,
  memory: memorySchema,
  code: codeSchema,
  business: businessSchema,
  notes: notesSchema
};

// src/agent-memory/extractor/cypher-builder.ts
function quote(v) {
  return '"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
function naturalKey(label, naturalKeys) {
  const key = (naturalKeys[label] ?? [])[0];
  if (!key) throw new Error(`no natural key for label ${label}`);
  return key;
}
function propsClause(label, props, naturalKeys) {
  const key = naturalKey(label, naturalKeys);
  return `{${key}:${quote(props[key])}}`;
}
var CREATED_AT = {
  Decision: "decidedAt",
  Insight: "createdAt",
  Question: "askedAt",
  Answer: "answeredAt"
};
function literal(v) {
  if (v === null || v === void 0) return null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return String(v);
  if (typeof v === "string") return quote(v);
  return null;
}
function setProps(alias, label, props, naturalKeys) {
  const key = naturalKey(label, naturalKeys);
  const parts = [];
  for (const [k, v] of Object.entries(props)) {
    if (k === key) continue;
    const lit = literal(v);
    if (lit === null) continue;
    parts.push(`${alias}.${k} = ${lit}`);
  }
  return parts.length ? `
SET ${parts.join(",\n    ")}` : "";
}
function onCreate(alias, label, props) {
  const ts = CREATED_AT[label];
  const extra = ts && props[ts] === void 0 ? `, ${alias}.${ts} = datetime()` : "";
  return `ON CREATE SET ${alias}.firstSeenAt = datetime()${extra}`;
}
function buildExtractorCypher(args) {
  const { triple, sessionDbId, naturalKeys } = args;
  const sub = propsClause(triple.subject.label, triple.subject.props, naturalKeys);
  const obj = propsClause(triple.object.label, triple.object.props, naturalKeys);
  const conf = triple.confidence != null ? `,
                r.confidence = ${triple.confidence}` : "";
  return `MERGE (s:${triple.subject.label} ${sub})
  ${onCreate("s", triple.subject.label, triple.subject.props)}${setProps("s", triple.subject.label, triple.subject.props, naturalKeys)}
MERGE (o:${triple.object.label} ${obj})
  ${onCreate("o", triple.object.label, triple.object.props)}${setProps("o", triple.object.label, triple.object.props, naturalKeys)}
MERGE (s)-[r:${triple.verb}]->(o)
  ON CREATE SET r.firstAt = datetime(),
                r.session = ${quote(sessionDbId)},
                r.evidence = ${quote(triple.evidence)}${conf},
                r.count = 1
  ON MATCH  SET r.lastAt = datetime(),
                r.count = coalesce(r.count, 1) + 1
MERGE (sess:Session {id: ${quote(sessionDbId)}})
MERGE (s)-[:DURING]->(sess)`;
}

// src/session-state.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// src/env-paths.ts
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
function configDir() {
  return join2(homedir2(), ".config", "arcadedb");
}
function projectsJsonPath() {
  return join2(configDir(), "projects.json");
}
function sessionsDir() {
  return join2(configDir(), "sessions");
}
function sessionStatePath(claudeCodeSessionId) {
  return join2(sessionsDir(), `${claudeCodeSessionId}.json`);
}
function dryrunPath(sessionDbId) {
  return join2(configDir(), "dryrun", `${sessionDbId}.jsonl`);
}
function extractorErrorsPath(sessionDbId, timestamp) {
  return join2(configDir(), "extractor-errors", `${sessionDbId}-${timestamp}.txt`);
}
function captureLogPath() {
  return join2(configDir(), "capture.log");
}

// src/session-state.ts
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
function markExtracted(claudeCodeSessionId, turnIdx, lineIdx) {
  const state = readSessionState(claudeCodeSessionId);
  if (!state) return null;
  state.lastExtractedTurnIdx = turnIdx;
  if (lineIdx !== void 0) state.lastExtractedLine = lineIdx;
  state.lastExtractedAt = (/* @__PURE__ */ new Date()).toISOString();
  state.extractInFlightSince = null;
  writeSessionState(state);
  return state;
}

// src/extractor-validator.ts
function validateExtraction(raw, vocab) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: `JSON parse failure: ${e.message}` };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, reason: "expected JSON object" };
  }
  const obj = parsed;
  if (!Array.isArray(obj.triples)) {
    return { ok: false, reason: "missing or invalid triples array" };
  }
  const labels = new Set(vocab.vertexLabels);
  const edges = new Set(vocab.edgeNames);
  const valid = [];
  const invalid = [];
  const pendingVocab = [];
  for (const t of obj.triples) {
    if (!t.evidence || typeof t.evidence !== "string") {
      invalid.push({ triple: t, reason: "missing evidence" });
      continue;
    }
    if (!labels.has(t.subject?.label) || !labels.has(t.object?.label) || !edges.has(t.verb)) {
      pendingVocab.push(t);
      continue;
    }
    const subKey = (vocab.naturalKeys[t.subject.label] ?? [])[0];
    const objKey = (vocab.naturalKeys[t.object.label] ?? [])[0];
    if (!subKey || t.subject.props?.[subKey] == null) {
      invalid.push({ triple: t, reason: `missing natural key '${subKey}' on subject ${t.subject.label}` });
      continue;
    }
    if (!objKey || t.object.props?.[objKey] == null) {
      invalid.push({ triple: t, reason: `missing natural key '${objKey}' on object ${t.object.label}` });
      continue;
    }
    valid.push(t);
  }
  return {
    ok: true,
    valid,
    invalid,
    pendingVocab,
    unknownTerms: Array.isArray(obj.unknown_terms) ? obj.unknown_terms : []
  };
}

// src/vocab-snapshot.ts
var NATURAL_KEYS = {
  Person: ["name"],
  File: ["path"],
  Function: ["name"],
  Class: ["name"],
  Component: ["name"],
  Repo: ["name"],
  Module: ["path"],
  Concept: ["name"],
  Tag: ["name"],
  Session: ["id"],
  Decision: ["id"],
  Insight: ["id"],
  Question: ["id"],
  Answer: ["id"],
  Note: ["id"]
};
function buildVocabSnapshot() {
  const labels = /* @__PURE__ */ new Set();
  const edges = /* @__PURE__ */ new Set();
  for (const schema of Object.values(allSchemas)) {
    for (const v of schema.vertices) labels.add(v.name);
    for (const e of schema.edges) edges.add(e.name);
  }
  return {
    vertexLabels: [...labels].sort(),
    edgeNames: [...edges].sort(),
    naturalKeys: { ...NATURAL_KEYS }
  };
}

// src/dryrun-writer.ts
import { appendFileSync, existsSync as existsSync2, mkdirSync as mkdirSync2 } from "node:fs";
import { dirname as dirname2 } from "node:path";
function writeDryrunBatch(args) {
  const path = dryrunPath(args.sessionDbId);
  if (!existsSync2(dirname2(path))) mkdirSync2(dirname2(path), { recursive: true });
  const vocab = buildVocabSnapshot();
  const lines = [];
  lines.push(JSON.stringify({
    kind: "batch",
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    claudeCodeSessionId: args.claudeCodeSessionId,
    turnRange: args.turnRange,
    counts: {
      valid: args.valid.length,
      invalid: args.invalid.length,
      pendingVocab: args.pendingVocab.length,
      unknownTerms: args.unknownTerms.length
    }
  }));
  for (const triple of args.valid) {
    let cypher = "";
    try {
      cypher = buildExtractorCypher({
        triple: { ...triple, evidence: triple.evidence ?? "" },
        sessionDbId: args.sessionDbId,
        naturalKeys: vocab.naturalKeys
      });
    } catch (e) {
      cypher = `// cypher-build error: ${e.message}`;
    }
    lines.push(JSON.stringify({ kind: "triple", triple, cypher }));
  }
  for (const inv of args.invalid) {
    lines.push(JSON.stringify({ kind: "invalid", triple: inv.triple, reason: inv.reason }));
  }
  for (const t of args.pendingVocab) {
    lines.push(JSON.stringify({ kind: "pendingVocab", triple: t }));
  }
  for (const u of args.unknownTerms) {
    lines.push(JSON.stringify({ kind: "unknownTerm", term: u }));
  }
  appendFileSync(path, lines.join("\n") + "\n");
}

// src/extract-write.ts
async function executeLiveBatch(valid, deps) {
  let written = 0;
  let failed = 0;
  const errors = [];
  for (const triple of valid) {
    try {
      const cypher = buildExtractorCypher({
        triple: { ...triple, evidence: triple.evidence ?? "" },
        sessionDbId: deps.sessionDbId,
        naturalKeys: deps.naturalKeys
      });
      await deps.execute(deps.memoryDb, cypher);
      written += 1;
    } catch (e) {
      failed += 1;
      errors.push(e.message);
    }
  }
  return { written, failed, errors };
}

// src/project-map.ts
import { readFileSync as readFileSync2, existsSync as existsSync3, realpathSync } from "node:fs";
import { basename } from "node:path";
var DEFAULT_MAP = {
  version: 1,
  defaultMemoryDb: "claude_memory",
  projects: {}
};
function loadProjects(path, onError) {
  if (!existsSync3(path)) return { ...DEFAULT_MAP, projects: {} };
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
    if (samePath(entry.path, cwd)) return { key, entry };
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
function samePath(a, b) {
  if (a === b) return true;
  try {
    if (!existsSync3(a) || !existsSync3(b)) return false;
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}
function extractRemoteName(url) {
  const m = url.match(/[/:]([\w.-]+?)(?:\.git)?\s*$/);
  return m?.[1] ?? null;
}

// src/config.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync3, readFileSync as readFileSync3, writeFileSync as writeFileSync2, renameSync, chmodSync } from "node:fs";
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
var KEYS = {
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
  if (!existsSync4(path)) return {};
  const map = {};
  for (const line of readFileSync3(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    map[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return map;
}
function writeEnvFile(values, path = envFilePath()) {
  const merged = { ...readEnvFile(path), ...values };
  const body = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  if (!existsSync4(dirname3(path))) mkdirSync3(dirname3(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync2(tmp, body, { mode: 384 });
  chmodSync(tmp, 384);
  renameSync(tmp, path);
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

// src/memory-db.ts
function resolveMemoryDb(cfg, map) {
  return cfg.sources.memoryDb === "default" ? map.defaultMemoryDb : cfg.memoryDb;
}

// src/extractor-prompt.ts
function buildExtractorSystemPrompt(vocab) {
  const labels = vocab.vertexLabels.join(", ");
  const edges = vocab.edgeNames.join(", ");
  const keys = Object.entries(vocab.naturalKeys).map(([label, ks]) => `  ${label}: ${ks.join(", ")}`).join("\n");
  return `You are a knowledge graph extractor for Claude Code sessions.

Read the supplied transcript slice and emit a JSON object containing structured triples that represent decisions, insights, questions, answers, blockers, fixes, and entity mentions.

# Allowed vocabulary

Vertex labels:
${labels}

Edge names (verbs):
${edges}

Natural keys (must be present in node props):
${keys}

# Output schema

\`\`\`json
{
  "triples": [
    {
      "subject": { "label": "<vertex>", "props": { "<naturalKey>": "..." } },
      "verb": "<edge>",
      "object":  { "label": "<vertex>", "props": { "<naturalKey>": "..." } },
      "evidence": "<verbatim quote, \u2264 200 chars>",
      "confidence": 0.0-1.0
    }
  ],
  "unknown_terms": [
    { "candidate": "...", "kind": "noun"|"verb", "context": "...", "suggested_existing": "..." }
  ],
  "skipped": "<reason if no triples; omit otherwise>"
}
\`\`\`

# Rules

1. Use only labels and verbs from the lists above. If a meaningful concept doesn't fit, add it to \`unknown_terms\` \u2014 do NOT invent labels.
2. Every triple needs an \`evidence\` quote, verbatim from the transcript, \u2264 200 chars.
3. Be **conservative**. Prefer fewer high-quality triples over speculation. Pure mechanics (file edits with no discussion) emit none.
4. "I", "the user", and "you" all refer to the same Person \u2014 emit \`{"label":"Person","props":{"name":"<userName from user prompt>"}}\`.
5. For Decisions, Insights, Questions, Answers: generate a fresh UUID v4 string for \`id\`.

# Few-shot examples

## Example 1: a decision

Transcript:
> User: should we go with redis or postgres for the rate limiter?
> Assistant: redis. it's already in the stack and the TTL semantics fit better.
> User: ok, do that.

Output:
\`\`\`json
{
  "triples": [
    {
      "subject": {"label":"Decision","props":{"id":"c8e7...","summary":"use Redis for rate limiter"}},
      "verb": "DECIDED_ON",
      "object": {"label":"Concept","props":{"name":"Redis"}},
      "evidence": "redis. it's already in the stack and the TTL semantics fit better.",
      "confidence": 0.95
    }
  ]
}
\`\`\`

## Example 2: a question + answer

Transcript:
> User: why doesn't the extractor capture conversations?
> Assistant: v0 only does session bookkeeping; the v1 LLM extractor isn't built yet.

Output:
\`\`\`json
{
  "triples": [
    {
      "subject": {"label":"Question","props":{"id":"a1b2...","text":"why doesn't the extractor capture conversations?"}},
      "verb": "ANSWERS",
      "object": {"label":"Answer","props":{"id":"f3e4...","text":"v0 only does session bookkeeping; v1 LLM extractor isn't built yet","confidence":0.9}},
      "evidence": "v0 only does session bookkeeping; the v1 LLM extractor isn't built yet.",
      "confidence": 0.9
    }
  ]
}
\`\`\`

## Example 3: a blocker with an unknown verb

Transcript:
> Assistant: I tried to run the indexer but the ArcadeDB endpoint times out from the hook context.

Output:
\`\`\`json
{
  "triples": [
    {
      "subject": {"label":"Concept","props":{"name":"indexer hook"}},
      "verb": "BLOCKED_BY",
      "object": {"label":"Concept","props":{"name":"ArcadeDB timeout"}},
      "evidence": "the ArcadeDB endpoint times out from the hook context",
      "confidence": 0.85
    }
  ],
  "unknown_terms": [
    { "candidate": "TIMES_OUT", "kind": "verb", "context": "endpoint times out from hook context", "suggested_existing": "BLOCKED_BY" }
  ]
}
\`\`\`

Return ONLY the JSON object. No prose, no markdown fences.`;
}

// src/capture-log.ts
import { appendFileSync as appendFileSync2, existsSync as existsSync5, mkdirSync as mkdirSync4 } from "node:fs";
import { dirname as dirname4 } from "node:path";
function logCapture(event, fields = {}) {
  try {
    const path = captureLogPath();
    if (!existsSync5(dirname4(path))) mkdirSync4(dirname4(path), { recursive: true });
    appendFileSync2(path, JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), event, ...fields }) + "\n");
  } catch {
  }
}

// src/config-cli.ts
import { spawnSync } from "node:child_process";

// src/server-probe.ts
async function get(url, headers, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    return { status: res.status };
  } catch (e) {
    return { error: e.message };
  } finally {
    clearTimeout(timer);
  }
}
async function probeServer(cfg, timeoutMs = 2e3) {
  const started = Date.now();
  const ready = await get(`${cfg.httpUri}/api/v1/ready`, {}, timeoutMs);
  if ("error" in ready || ready.status < 200 || ready.status >= 300) {
    return { status: "unreachable", httpUri: cfg.httpUri, latencyMs: Date.now() - started, detail: "error" in ready ? ready.error : `HTTP ${ready.status}` };
  }
  if (cfg.password === "") {
    return { status: "no_password", httpUri: cfg.httpUri, latencyMs: Date.now() - started };
  }
  const auth = "Basic " + Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");
  const dbs = await get(`${cfg.httpUri}/api/v1/databases`, { Authorization: auth }, timeoutMs);
  const latencyMs = Date.now() - started;
  if ("error" in dbs) return { status: "unreachable", httpUri: cfg.httpUri, latencyMs, detail: dbs.error };
  if (dbs.status === 401 || dbs.status === 403) return { status: "unauthorized", httpUri: cfg.httpUri, latencyMs };
  if (dbs.status >= 200 && dbs.status < 300) return { status: "ok", httpUri: cfg.httpUri, latencyMs };
  return { status: "unreachable", httpUri: cfg.httpUri, latencyMs, detail: `HTTP ${dbs.status}` };
}
var OFF_LINE = "  Capture and code graph are off until then.";
function probeBanner(r, username) {
  switch (r.status) {
    case "ok":
      return [`  Server: ${r.httpUri} (ok, ${r.latencyMs} ms)`];
    case "unreachable":
      return [`ArcadeDB: server not reachable at ${r.httpUri}. Start ArcadeDB or run: /arcadedb-config set server http://host:port`, OFF_LINE];
    case "no_password":
      return [`ArcadeDB: server reachable at ${r.httpUri} but no password configured. Run: /arcadedb-config set password <root-password>`, OFF_LINE];
    case "unauthorized":
      return [`ArcadeDB: authentication failed at ${r.httpUri} for user ${username}. Run: /arcadedb-config set password <root-password>`, OFF_LINE];
  }
}

// src/auto-register.ts
import { existsSync as existsSync6, mkdirSync as mkdirSync5, readFileSync as readFileSync4, renameSync as renameSync2, writeFileSync as writeFileSync3 } from "node:fs";
import { basename as basename2, dirname as dirname5, join as join4 } from "node:path";
function writeProjectsFile(projectsPath, map) {
  const dir = dirname5(projectsPath);
  if (!existsSync6(dir)) mkdirSync5(dir, { recursive: true });
  const tmp = `${projectsPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync3(tmp, JSON.stringify(map, null, 2) + "\n");
  renameSync2(tmp, projectsPath);
}
function removeProject(projectsPath, key) {
  const map = loadProjects(projectsPath, (err) => {
    throw err;
  });
  if (!map.projects[key]) return false;
  delete map.projects[key];
  writeProjectsFile(projectsPath, map);
  return true;
}

// src/index-need.ts
import { existsSync as existsSync7, readFileSync as readFileSync5 } from "node:fs";
import { join as join5 } from "node:path";
function stalePath() {
  return join5(configDir(), "stale.log");
}
function staleEditsSince(path, key, since) {
  if (!existsSync7(path)) return 0;
  const sinceMs = since ? new Date(since).getTime() : -Infinity;
  let n = 0;
  for (const line of readFileSync5(path, "utf8").split("\n")) {
    const m = /^\[([^\]]+)\] (\S+) \(/.exec(line);
    if (!m || m[2] !== key) continue;
    if (new Date(m[1]).getTime() > sinceMs) n++;
  }
  return n;
}

// src/index-spawn.ts
import { createRequire } from "node:module";
import { basename as basename3, dirname as dirname6, join as join6 } from "node:path";
import { fileURLToPath } from "node:url";
function resolveRunner(here, pluginRoot, name = "index-runner") {
  if (pluginRoot) return join6(pluginRoot, "hooks", `${name}.js`);
  if (here.endsWith(".ts")) return join6(dirname6(here), `${name}.ts`);
  const dir = dirname6(here);
  if (basename3(dir) === "src" && basename3(dirname6(dir)) === "dist") {
    return join6(dir, "..", "..", "hooks", `${name}.js`);
  }
  return join6(dir, `${name}.js`);
}
function runnerPath(name = "index-runner") {
  return resolveRunner(fileURLToPath(import.meta.url), process.env["CLAUDE_PLUGIN_ROOT"] || void 0, name);
}
function runnerArgv(runner, args) {
  const argv = runner.endsWith(".ts") ? [createRequire(import.meta.url).resolve("tsx/cli"), runner] : [runner];
  argv.push(...args);
  return argv;
}

// src/embed.ts
import { existsSync as existsSync8, closeSync, openSync, statSync, mkdirSync as mkdirSync6, writeFileSync as writeFileSync4, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire as createRequire2 } from "node:module";
import { join as join7 } from "node:path";
import { pathToFileURL } from "node:url";
var EMBED_PACKAGE = "@xenova/transformers@2";
var EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
var EMBED_MAX_CHARS = 2e3;
var INSTALL_STALE_MS = 30 * 60 * 1e3;
function embedDir() {
  return join7(configDir(), "embed");
}
function embedInstallLock() {
  return join7(embedDir(), "install.lock");
}
function isEmbedInstalled(dir = embedDir()) {
  return existsSync8(join7(dir, "node_modules", "@xenova", "transformers", "package.json"));
}
function isEmbedInstalling(lock = embedInstallLock(), now = Date.now()) {
  try {
    return now - statSync(lock).mtimeMs < INSTALL_STALE_MS;
  } catch {
    return false;
  }
}
function embedStatus(dir = embedDir()) {
  if (isEmbedInstalled(dir)) return "ready";
  return isEmbedInstalling(join7(dir, "install.lock")) ? "installing" : "missing";
}
function spawnEmbedInstall(dir = embedDir()) {
  if (isEmbedInstalled(dir)) return null;
  const lock = join7(dir, "install.lock");
  if (isEmbedInstalling(lock)) return null;
  try {
    mkdirSync6(dir, { recursive: true });
    if (!existsSync8(join7(dir, "package.json"))) {
      writeFileSync4(join7(dir, "package.json"), JSON.stringify({ name: "arcadedb-embed", private: true }, null, 2) + "\n");
    }
    writeFileSync4(lock, String(process.pid));
    const log = openSync(join7(dir, "install.log"), "a");
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(npm, ["install", "--no-audit", "--no-fund", "--loglevel=error", EMBED_PACKAGE], {
      cwd: dir,
      detached: true,
      stdio: ["ignore", log, log],
      env: process.env
    });
    closeSync(log);
    child.on("exit", () => {
      try {
        unlinkSync(lock);
      } catch {
      }
    });
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  }
}
async function loadEmbedder(dir = embedDir()) {
  if (!isEmbedInstalled(dir)) {
    throw new Error(`embedding runtime not installed in ${dir} (run: arcadedb-skills embed install)`);
  }
  const req = createRequire2(join7(dir, "package.json"));
  const entry = req.resolve("@xenova/transformers");
  const mod = await import(pathToFileURL(entry).href);
  mod.env.cacheDir = join7(dir, "models");
  mod.env.allowLocalModels = false;
  const pipe = await mod.pipeline("feature-extraction", EMBED_MODEL, { quantized: true });
  return async (texts) => {
    if (texts.length === 0) return [];
    const inputs = texts.map((t) => (t.length > EMBED_MAX_CHARS ? t.slice(0, EMBED_MAX_CHARS) : t) || " ");
    const out = await pipe(inputs, { pooling: "mean", normalize: true });
    const dims = out.dims[out.dims.length - 1] ?? EMBEDDING_DIMENSIONS;
    const rows = [];
    for (let i = 0; i < inputs.length; i++) {
      rows.push(Array.from(out.data.subarray(i * dims, (i + 1) * dims)));
    }
    return rows;
  };
}

// src/config-cli.ts
var SET_KEYS = {
  server: { env: "ARCADEDB_HTTP_URI", validate: (v) => /^https?:\/\/[^\s/]+$/.test(v) ? null : "expected http://host:port" },
  user: { env: "ARCADEDB_USERNAME", validate: (v) => v.trim() ? null : "expected a user name" },
  password: { env: "ARCADEDB_ROOT_PASSWORD", validate: (v) => v ? null : "expected a non-empty password" },
  "memory-db": { env: "ARCADEDB_MEMORY_DB", validate: (v) => /^[a-z][a-z0-9_]*$/.test(v) ? null : "expected [a-z][a-z0-9_]*" },
  "auto-index": { env: "ARCADEDB_AUTO_INDEX", validate: (v) => v === "on" || v === "off" ? null : "expected on or off" },
  capture: { env: "ARCADEDB_CAPTURE", validate: (v) => v === "on" || v === "off" ? null : "expected on or off" },
  embed: { env: "ARCADEDB_EMBED", validate: (v) => v === "on" || v === "off" ? null : "expected on or off" },
  extractor: { env: "ARCADEDB_EXTRACTOR", validate: (v) => v === "off" || v === "live" || v === "dryrun" ? null : "expected off, live or dryrun" }
};
var SET_KEY_NAMES = Object.keys(SET_KEYS).join("|");
function pad(s, n) {
  return s.padEnd(n);
}
async function configShow(io) {
  const cfg = resolveConfig();
  const map = loadProjects(projectsJsonPath());
  const memoryDb = resolveMemoryDb(cfg, map);
  io.out(`ArcadeDB config (${cfg.envPath})`);
  io.out(`  ${pad("server:", 12)}${pad(cfg.httpUri, 24)}(${cfg.sources.httpUri})`);
  io.out(`  ${pad("user:", 12)}${pad(cfg.username, 24)}(${cfg.sources.username})`);
  io.out(`  ${pad("password:", 12)}${pad(cfg.password ? "********" : "(not set)", 24)}(${cfg.sources.password})`);
  io.out(`  ${pad("memory-db:", 12)}${pad(memoryDb, 24)}(${cfg.sources.memoryDb})`);
  io.out(`  ${pad("auto-index:", 12)}${pad(cfg.autoIndex ? "on" : "off", 24)}(${cfg.sources.autoIndex})`);
  io.out(`  ${pad("capture:", 12)}${pad(cfg.capture ? "on" : "off", 24)}(${cfg.sources.capture})`);
  io.out(`  ${pad("embed:", 12)}${pad(cfg.embed ? `on, runtime ${embedStatus()}` : "off", 24)}(${cfg.sources.embed})`);
  io.out(`  ${pad("extractor:", 12)}${pad(cfg.extractor, 24)}(${cfg.sources.extractor})`);
  const probe = await probeServer(toClientEnv(cfg));
  const bannerLines = probeBanner(probe, cfg.username);
  io.out(probe.status === "ok" ? bannerLines[0].replace(/^ {2}/, "") : bannerLines[0]);
  const keys = Object.keys(map.projects);
  io.out(`Projects (${keys.length}):`);
  for (const key of keys) {
    const e = map.projects[key];
    io.out(`  ${key} -> ${e.db} (indexed: ${e.lastIndexed ?? "never"}, stale edits: ${staleEditsSince(stalePath(), key, e.lastIndexed)}, ${e.path})`);
  }
  return 0;
}
function configSet(key, value, io) {
  const spec = SET_KEYS[key];
  if (!spec) {
    io.err?.(`unknown key: ${key} (${SET_KEY_NAMES})`);
    return 1;
  }
  if (/[\n\r]/.test(value)) {
    io.err?.(`invalid value for ${key}: must not contain line breaks`);
    return 1;
  }
  const problem = spec.validate(value);
  if (problem) {
    io.err?.(`invalid value for ${key}: ${problem}`);
    return 1;
  }
  writeEnvFile({ [spec.env]: value });
  io.out(`${key} updated in ${resolveConfig().envPath}`);
  return 0;
}
async function configTest(io) {
  const cfg = resolveConfig();
  const probe = await probeServer(toClientEnv(cfg));
  for (const line of probeBanner(probe, cfg.username)) io.out(line.replace(/^ {2}/, ""));
  return probe.status === "ok" ? 0 : 1;
}
async function configForget(key, dropDb, io) {
  const map = loadProjects(projectsJsonPath());
  const entry = map.projects[key];
  if (!entry) {
    io.err?.(`not registered: ${key}`);
    return 1;
  }
  if (dropDb) {
    if (!/^[a-z][a-z0-9_]*$/.test(entry.db)) {
      io.err?.(`refusing to drop database with unsafe name: ${entry.db}`);
      return 1;
    }
    const client = new Client(toClientEnv(resolveConfig()));
    await client.command(`drop database ${entry.db}`);
    io.out(`dropped database ${entry.db}`);
  }
  removeProject(projectsJsonPath(), key);
  io.out(`forgot ${key}`);
  return 0;
}
async function configIndex(keyArg, cwd, io) {
  const map = loadProjects(projectsJsonPath());
  const match = keyArg ? map.projects[keyArg] ? { key: keyArg, entry: map.projects[keyArg] } : null : findProject(map, cwd, null);
  if (!match) {
    io.err?.("not registered: start a Claude Code session in the repo root once, then re-run");
    return 1;
  }
  const cmdArgs = ["--root", match.entry.path, "--db", match.entry.db, "--key", match.key];
  if (match.entry.stack.length) cmdArgs.push("--stack", match.entry.stack.join(","));
  const argv = runnerArgv(runnerPath(), cmdArgs);
  const r = spawnSync(process.execPath, argv, { stdio: "inherit", env: process.env });
  return r.status ?? 1;
}

// src/embed-runner.ts
import { unlinkSync as unlinkSync3 } from "node:fs";
import { join as join8 } from "node:path";

// src/lock.ts
import { closeSync as closeSync2, openSync as openSync2, readFileSync as readFileSync6, unlinkSync as unlinkSync2, writeSync } from "node:fs";
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function createLock(path) {
  let fd;
  try {
    fd = openSync2(path, "wx");
  } catch {
    return false;
  }
  try {
    writeSync(fd, String(process.pid));
  } finally {
    closeSync2(fd);
  }
  return true;
}
function acquireLock(path) {
  if (createLock(path)) return true;
  let pid = NaN;
  try {
    pid = Number(readFileSync6(path, "utf8").trim());
  } catch {
    return false;
  }
  if (Number.isFinite(pid) && pid > 0 && pidAlive(pid)) return false;
  try {
    unlinkSync2(path);
  } catch {
    return false;
  }
  return createLock(path);
}

// src/embed-runner.ts
var BATCH = 64;
var TEXT_EXPR = {
  Turn: "text",
  Decision: "ifnull(summary, '') + ' ' + ifnull(rationale, '')",
  Insight: "ifnull(topic, '') + ' ' + ifnull(text, '')",
  Question: "ifnull(text, '')",
  Answer: "ifnull(text, '')"
};
function flag(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? void 0 : argv[i + 1];
}
async function embedPending(client, db, embed, types = EMBEDDED_TYPES) {
  let total = 0;
  for (const type of types) {
    const expr = TEXT_EXPR[type] ?? "text";
    for (; ; ) {
      const rows = await client.query(
        db,
        "sql",
        `SELECT @rid AS rid, ${expr} AS body FROM ${type} WHERE embedding IS NULL LIMIT ${BATCH}`
      );
      if (rows.length === 0) break;
      const vectors = await embed(rows.map((r) => r.body ?? ""));
      for (let i = 0; i < rows.length; i++) {
        const vec = vectors[i];
        await client.execute(
          db,
          "sql",
          `UPDATE ${rows[i].rid} SET embedding = [${vec.map((v) => v.toFixed(6)).join(",")}]`
        );
      }
      total += rows.length;
      if (rows.length < BATCH) break;
    }
  }
  return total;
}
async function main() {
  const db = flag(process.argv, "db");
  if (!db) {
    console.error("usage: embed-runner --db <name>");
    process.exit(2);
  }
  if (!isEmbedInstalled()) {
    logCapture("embed_skip", { reason: "not_installed", db });
    return;
  }
  const lock = join8(configDir(), "embed.lock");
  if (!acquireLock(lock)) {
    logCapture("embed_skip", { reason: "locked", db });
    return;
  }
  const started = Date.now();
  try {
    const cfg = resolveConfig();
    const client = new Client(toClientEnv(cfg), { timeoutMs: 3e4 });
    const embed = await loadEmbedder();
    const n = await embedPending(client, db, embed);
    if (n > 0) logCapture("embed_done", { db, embedded: n, ms: Date.now() - started });
  } catch (err) {
    logCapture("embed_failed", { db, error: err?.message ?? String(err) });
    process.exitCode = 1;
  } finally {
    try {
      unlinkSync3(lock);
    } catch {
    }
  }
}
var isEntry = process.argv[1] !== void 0 && /embed-runner\.(?:js|ts)$/.test(process.argv[1]);
if (isEntry) {
  main().catch((err) => {
    logCapture("embed_failed", { error: err?.message ?? String(err) });
    process.exit(1);
  });
}

// src/search.ts
var AT_EXPR = {
  Turn: "ts",
  Decision: "decidedAt",
  Insight: "createdAt",
  Question: "askedAt",
  Answer: "answeredAt"
};
async function semanticSearch(client, db, embed, query, opts = {}) {
  const limit = opts.limit ?? 10;
  const types = opts.types ?? EMBEDDED_TYPES;
  const [vec] = await embed([query]);
  const literal2 = `[${vec.map((v) => v.toFixed(6)).join(",")}]`;
  const hits = [];
  for (const type of types) {
    const repoClause = opts.repo ? ` AND repo = '${opts.repo.replace(/'/g, "\\'")}'` : "";
    const rows = await client.query(
      db,
      "sql",
      `SELECT @rid AS rid, ${TEXT_EXPR[type]} AS body, repo, ${AT_EXPR[type]} AS at, ${type === "Turn" ? "sessionId" : "null"} AS sessionId,
              vectorCosineSimilarity(embedding, ${literal2}) AS score
       FROM ${type} WHERE embedding IS NOT NULL${repoClause}
       ORDER BY score DESC LIMIT ${limit}`
    );
    for (const r of rows) {
      hits.push({ type, score: r.score, text: r.body ?? "", repo: r.repo ?? null, at: r.at ?? null, sessionId: r.sessionId ?? null, rid: r.rid });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
function formatHits(hits, maxChars = 400) {
  if (hits.length === 0) return "no matches (nothing embedded yet, or embeddings still running)";
  return hits.map((h, i) => {
    const text = h.text.length > maxChars ? h.text.slice(0, maxChars) + "..." : h.text;
    const meta = [h.type, h.repo, h.at ? h.at.slice(0, 16) : null].filter(Boolean).join(" | ");
    return `${i + 1}. [${h.score.toFixed(3)}] ${meta}
   ${text.replace(/\n/g, "\n   ")}`;
  }).join("\n");
}

// bin/arcadedb-skills.ts
function flag2(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? void 0 : argv[i + 1];
}
function usage() {
  console.error("usage: arcadedb-skills <command> [options]");
  console.error("commands:");
  console.error("  mark-extracted --session <id> --turn <n>   update session state after extractor finishes");
  console.error("  extractor-prompt                           print the extractor system prompt");
  console.error("  extract-write --raw <file> --session <sessionDbId> --cc-session <id> --turns <N..M> --mode <live|dryrun> [--lines <A..B>] [--turn <n>]");
  console.error(`  config show | set <${SET_KEY_NAMES}> <value> | test | forget <key> [--drop-db] | index [<key>]`);
  console.error("  search <query> [--limit <n>] [--types Turn,Decision,...] [--repo <name>] [--json]   semantic search over captured memory");
  console.error("  embed install | status | run              manage the local embedding runtime");
  console.error("  extract-replay <sessionDbId|audit.jsonl>  re-write a session's audited triples into the graph (repairs nodes written without text)");
}
async function main2() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) {
    usage();
    return 1;
  }
  if (cmd === "mark-extracted") {
    const session = flag2(rest, "session");
    const turnArg = flag2(rest, "turn");
    const turn = Number(turnArg);
    if (!session || turnArg === void 0 || !Number.isFinite(turn)) {
      console.error("usage: arcadedb-skills mark-extracted --session <id> --turn <n>");
      return 1;
    }
    const updated = markExtracted(session, turn);
    if (updated) {
      console.log(`marked turn ${turn} as extracted for session ${session}`);
      return 0;
    }
    console.error(`no state file for session ${session}`);
    return 1;
  }
  if (cmd === "search") {
    const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--") && rest[i - 1] !== "--json"));
    const query = positional.join(" ").trim();
    if (!query) {
      console.error("usage: arcadedb-skills search <query> [--limit <n>] [--types Turn,Decision,...] [--repo <name>] [--json]");
      return 1;
    }
    if (embedStatus() !== "ready") {
      console.error(`embedding runtime not ready (${embedStatus()}); run: arcadedb-skills embed install`);
      return 2;
    }
    const limit = Number(flag2(rest, "limit") ?? 10);
    const typesArg = flag2(rest, "types");
    const types = typesArg ? typesArg.split(",").map((t) => t.trim()).filter((t) => EMBEDDED_TYPES.includes(t)) : void 0;
    const cfg = resolveConfig();
    const client = new Client(toClientEnv(cfg));
    const db = resolveMemoryDb(cfg, loadProjects(projectsJsonPath()));
    const embed = await loadEmbedder();
    const hits = await semanticSearch(client, db, embed, query, { limit: Number.isFinite(limit) ? limit : 10, types, repo: flag2(rest, "repo") });
    console.log(rest.includes("--json") ? JSON.stringify(hits, null, 2) : formatHits(hits));
    return 0;
  }
  if (cmd === "embed") {
    const sub = rest[0];
    if (sub === "status") {
      console.log(`embedding runtime: ${embedStatus()} (${embedDir()})`);
      return 0;
    }
    if (sub === "install") {
      const status = embedStatus();
      if (status === "ready") {
        console.log("embedding runtime already installed");
        return 0;
      }
      const pid = spawnEmbedInstall();
      console.log(pid ? `installing @xenova/transformers into ${embedDir()} in the background (pid ${pid}); check: arcadedb-skills embed status` : status === "installing" ? "install already running" : "could not start npm install (is npm on PATH?)");
      return pid || status === "installing" ? 0 : 1;
    }
    if (sub === "run") {
      if (embedStatus() !== "ready") {
        console.error(`embedding runtime not ready (${embedStatus()})`);
        return 2;
      }
      const cfg = resolveConfig();
      const client = new Client(toClientEnv(cfg), { timeoutMs: 3e4 });
      const db = resolveMemoryDb(cfg, loadProjects(projectsJsonPath()));
      const n = await embedPending(client, db, await loadEmbedder());
      console.log(`embedded ${n} node(s) in ${db}`);
      return 0;
    }
    console.error("usage: arcadedb-skills embed <install|status|run>");
    return 1;
  }
  if (cmd === "extract-replay") {
    const target = rest[0];
    if (!target) {
      console.error("usage: arcadedb-skills extract-replay <sessionDbId|path/to/audit.jsonl>");
      return 1;
    }
    const auditPath = existsSync9(target) ? target : dryrunPath(target);
    if (!existsSync9(auditPath)) {
      console.error(`no audit file at ${auditPath}`);
      return 1;
    }
    const triples = [];
    let sessionDbId = flag2(rest, "session");
    for (const line of readFileSync7(auditPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.kind === "batch" && entry.sessionDbId && !sessionDbId) sessionDbId = entry.sessionDbId;
      if (entry.kind === "triple" && entry.triple) triples.push(entry.triple);
    }
    if (!sessionDbId) sessionDbId = target.replace(/^.*\//, "").replace(/\.jsonl$/, "");
    const cfg = resolveConfig();
    const client = new Client(toClientEnv(cfg));
    const db = resolveMemoryDb(cfg, loadProjects(projectsJsonPath()));
    const result = await executeLiveBatch(triples, {
      execute: (d, cypher) => client.execute(d, "cypher", cypher),
      memoryDb: db,
      naturalKeys: buildVocabSnapshot().naturalKeys,
      sessionDbId
    });
    let cleared = 0;
    for (const t of triples) {
      for (const node of [t.subject, t.object]) {
        if (!EMBEDDED_TYPES.includes(node.label)) continue;
        const id = node.props["id"];
        if (typeof id !== "string") continue;
        await client.execute(db, "cypher", `MATCH (n:${node.label} {id: '${id.replace(/'/g, "\\'")}'}) SET n.embedding = null`);
        cleared += 1;
      }
    }
    let embedded = 0;
    if (cfg.embed && embedStatus() === "ready") embedded = await embedPending(client, db, await loadEmbedder());
    logCapture("replay", { sessionDbId, db, audit: auditPath, ...result, cleared, embedded });
    console.log(JSON.stringify({ sessionDbId, db, triples: triples.length, written: result.written, failed: result.failed, embedded, errors: result.errors.slice(0, 3) }));
    return result.failed ? 1 : 0;
  }
  if (cmd === "extractor-prompt") {
    process.stdout.write(buildExtractorSystemPrompt(buildVocabSnapshot()));
    return 0;
  }
  if (cmd === "extract-write") {
    const rawFile = flag2(rest, "raw");
    const sessionDbId = flag2(rest, "session");
    const ccSession = flag2(rest, "cc-session");
    const turns = flag2(rest, "turns");
    const mode = (flag2(rest, "mode") ?? "live").toLowerCase();
    if (!rawFile || !sessionDbId || !ccSession || !turns) {
      console.error("usage: arcadedb-skills extract-write --raw <file> --session <sessionDbId> --cc-session <id> --turns <N..M> --mode <live|dryrun>");
      return 1;
    }
    const lines = flag2(rest, "lines");
    const turnArg = flag2(rest, "turn");
    const turn = turnArg === void 0 ? void 0 : Number(turnArg);
    const lineEnd = lines ? Number(lines.split("..")[1]) : void 0;
    const markIfRequested = () => {
      if (turn !== void 0 && Number.isFinite(turn)) {
        markExtracted(ccSession, turn, Number.isFinite(lineEnd) ? lineEnd : void 0);
      }
    };
    const raw = readFileSync7(rawFile, "utf8");
    const vocab = buildVocabSnapshot();
    const result = validateExtraction(raw, vocab);
    if (!result.ok) {
      const path = extractorErrorsPath(sessionDbId, (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-"));
      if (!existsSync9(dirname7(path))) mkdirSync7(dirname7(path), { recursive: true });
      writeFileSync5(path, `validation failed: ${result.reason}

${raw}`);
      logCapture("validation_failed", { session: ccSession, sessionDbId, reason: result.reason });
      markIfRequested();
      console.log(JSON.stringify({ ok: false, reason: result.reason }));
      return 0;
    }
    writeDryrunBatch({
      sessionDbId,
      claudeCodeSessionId: ccSession,
      turnRange: turns,
      valid: result.valid,
      invalid: result.invalid,
      pendingVocab: result.pendingVocab,
      unknownTerms: result.unknownTerms
    });
    let live = { written: 0, failed: 0, errors: [] };
    if (mode === "live") {
      try {
        const map = loadProjects(projectsJsonPath());
        const cfg = resolveConfig();
        const client = new Client(toClientEnv(cfg));
        live = await executeLiveBatch(result.valid, {
          execute: (db, cypher) => client.execute(db, "cypher", cypher),
          memoryDb: resolveMemoryDb(cfg, map),
          naturalKeys: vocab.naturalKeys,
          sessionDbId
        });
      } catch (e) {
        live = { written: 0, failed: result.valid.length, errors: [`live write unavailable: ${e.message}`] };
      }
    }
    const summary = {
      ok: true,
      mode,
      counts: {
        valid: result.valid.length,
        invalid: result.invalid.length,
        pendingVocab: result.pendingVocab.length,
        unknownTerms: result.unknownTerms.length,
        written: live.written,
        failed: live.failed
      },
      errors: live.errors
    };
    const liveFailed = mode === "live" && live.failed > 0;
    if (liveFailed) {
      logCapture("write_failed", { session: ccSession, sessionDbId, mode, lines, written: live.written, failed: live.failed, errors: live.errors });
      console.error(`live write failed: ${live.failed} of ${result.valid.length} triples not written
${live.errors.join("\n")}`);
      console.log(JSON.stringify({ ...summary, ok: false }));
      markIfRequested();
      return 1;
    }
    markIfRequested();
    logCapture("write", { session: ccSession, sessionDbId, mode, lines, written: live.written, failed: live.failed, invalid: result.invalid.length });
    console.log(JSON.stringify(summary));
    return 0;
  }
  if (cmd === "config") {
    const [sub, ...args] = rest;
    const io = { out: (s) => console.log(s), err: (s) => console.error(s) };
    switch (sub) {
      case "show":
        return configShow(io);
      case "set": {
        const [key, ...valueParts] = args;
        if (!key || valueParts.length === 0) {
          console.error(`usage: arcadedb-skills config set <${SET_KEY_NAMES}> <value>`);
          return 1;
        }
        const code = configSet(key, valueParts.join(" "), io);
        if (code === 0 && (key === "server" || key === "user" || key === "password")) {
          await configTest(io);
        }
        return code;
      }
      case "test":
        return configTest(io);
      case "forget": {
        const key = args.find((a) => !a.startsWith("--"));
        if (!key) {
          console.error("usage: arcadedb-skills config forget <key> [--drop-db]");
          return 1;
        }
        return configForget(key, args.includes("--drop-db"), io);
      }
      case "index":
        return configIndex(args[0] ?? null, process.env["PWD"] ?? process.cwd(), io);
      default:
        console.error("usage: arcadedb-skills config <show|set|test|forget|index>");
        return 1;
    }
  }
  console.error(`unknown command: ${cmd}`);
  usage();
  return 1;
}
main2().then((c) => process.exit(c)).catch((e) => {
  console.error(e);
  process.exit(1);
});
