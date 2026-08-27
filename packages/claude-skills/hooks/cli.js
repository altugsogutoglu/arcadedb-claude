#!/usr/bin/env node

// bin/arcadedb-skills.ts
import { readFileSync as readFileSync6, writeFileSync as writeFileSync4, mkdirSync as mkdirSync6, existsSync as existsSync8 } from "node:fs";
import { dirname as dirname7 } from "node:path";

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
var DEFAULT_TIMEOUT_MS = 1e4;
var Client = class {
  env;
  timeoutMs;
  constructor(env, options = {}) {
    this.env = env;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
    if (!res.ok)
      throw new Error(`ArcadeDB ${res.status} ${res.statusText}`);
    const data = await res.json();
    return data.result;
  }
};

// ../agent-memory/dist/src/env.js
import { homedir } from "node:os";
import { join } from "node:path";
var DEFAULT_PATH = join(homedir(), ".config", "arcadedb", ".env");

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

// ../agent-memory/dist/src/extractor/cypher-builder.js
function quote(v) {
  return '"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
function propsClause(label, props, naturalKeys) {
  const key = (naturalKeys[label] ?? [])[0];
  if (!key)
    throw new Error(`no natural key for label ${label}`);
  return `{${key}:${quote(props[key])}}`;
}
function buildExtractorCypher(args) {
  const { triple, sessionDbId, naturalKeys } = args;
  const sub = propsClause(triple.subject.label, triple.subject.props, naturalKeys);
  const obj = propsClause(triple.object.label, triple.object.props, naturalKeys);
  const conf = triple.confidence != null ? `,
                r.confidence = ${triple.confidence}` : "";
  return `MERGE (s:${triple.subject.label} ${sub})
  ON CREATE SET s.firstSeenAt = datetime()
MERGE (o:${triple.object.label} ${obj})
  ON CREATE SET o.firstSeenAt = datetime()
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
function markExtracted(claudeCodeSessionId, turnIdx, lineIdx) {
  const state = readSessionState(claudeCodeSessionId);
  if (!state) return null;
  state.lastExtractedTurnIdx = turnIdx;
  if (lineIdx !== void 0) state.lastExtractedLine = lineIdx;
  state.lastExtractedAt = (/* @__PURE__ */ new Date()).toISOString();
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
  autoIndex: true
};
var KEYS = {
  httpUri: "ARCADEDB_HTTP_URI",
  username: "ARCADEDB_USERNAME",
  password: "ARCADEDB_ROOT_PASSWORD",
  memoryDb: "ARCADEDB_MEMORY_DB",
  autoIndex: "ARCADEDB_AUTO_INDEX"
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
  return {
    httpUri: httpUri.value.replace(/\/+$/, ""),
    username: username.value,
    password: password.value,
    memoryDb: memoryDb.value,
    autoIndex: autoIndexRaw.value.toLowerCase() !== "off",
    envPath,
    sources: {
      httpUri: httpUri.source,
      username: username.source,
      password: password.source,
      memoryDb: memoryDb.source,
      autoIndex: autoIndexRaw.source
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
function resolveRunner(here, pluginRoot) {
  if (pluginRoot) return join6(pluginRoot, "hooks", "index-runner.js");
  if (here.endsWith(".ts")) return join6(dirname6(here), "index-runner.ts");
  const dir = dirname6(here);
  if (basename3(dir) === "src" && basename3(dirname6(dir)) === "dist") {
    return join6(dir, "..", "..", "hooks", "index-runner.js");
  }
  return join6(dir, "index-runner.js");
}
function runnerPath() {
  return resolveRunner(fileURLToPath(import.meta.url), process.env["CLAUDE_PLUGIN_ROOT"] || void 0);
}
function runnerArgv(runner, args) {
  const argv = runner.endsWith(".ts") ? [createRequire(import.meta.url).resolve("tsx/cli"), runner] : [runner];
  argv.push(...args);
  return argv;
}

// src/config-cli.ts
var SET_KEYS = {
  server: { env: "ARCADEDB_HTTP_URI", validate: (v) => /^https?:\/\/[^\s/]+$/.test(v) ? null : "expected http://host:port" },
  user: { env: "ARCADEDB_USERNAME", validate: (v) => v.trim() ? null : "expected a user name" },
  password: { env: "ARCADEDB_ROOT_PASSWORD", validate: (v) => v ? null : "expected a non-empty password" },
  "memory-db": { env: "ARCADEDB_MEMORY_DB", validate: (v) => /^[a-z][a-z0-9_]*$/.test(v) ? null : "expected [a-z][a-z0-9_]*" },
  "auto-index": { env: "ARCADEDB_AUTO_INDEX", validate: (v) => v === "on" || v === "off" ? null : "expected on or off" }
};
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
    io.err?.(`unknown key: ${key} (server|user|password|memory-db|auto-index)`);
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

// bin/arcadedb-skills.ts
function flag(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? void 0 : argv[i + 1];
}
function usage() {
  console.error("usage: arcadedb-skills <command> [options]");
  console.error("commands:");
  console.error("  mark-extracted --session <id> --turn <n>   update session state after extractor finishes");
  console.error("  extractor-prompt                           print the extractor system prompt");
  console.error("  extract-write --raw <file> --session <sessionDbId> --cc-session <id> --turns <N..M> --mode <live|dryrun> [--lines <A..B>] [--turn <n>]");
  console.error("  config show | set <server|user|password|memory-db|auto-index> <value> | test | forget <key> [--drop-db] | index [<key>]");
}
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) {
    usage();
    return 1;
  }
  if (cmd === "mark-extracted") {
    const session = flag(rest, "session");
    const turnArg = flag(rest, "turn");
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
  if (cmd === "extractor-prompt") {
    process.stdout.write(buildExtractorSystemPrompt(buildVocabSnapshot()));
    return 0;
  }
  if (cmd === "extract-write") {
    const rawFile = flag(rest, "raw");
    const sessionDbId = flag(rest, "session");
    const ccSession = flag(rest, "cc-session");
    const turns = flag(rest, "turns");
    const mode = (flag(rest, "mode") ?? "live").toLowerCase();
    if (!rawFile || !sessionDbId || !ccSession || !turns) {
      console.error("usage: arcadedb-skills extract-write --raw <file> --session <sessionDbId> --cc-session <id> --turns <N..M> --mode <live|dryrun>");
      return 1;
    }
    const lines = flag(rest, "lines");
    const turnArg = flag(rest, "turn");
    const turn = turnArg === void 0 ? void 0 : Number(turnArg);
    const lineEnd = lines ? Number(lines.split("..")[1]) : void 0;
    const markIfRequested = () => {
      if (turn !== void 0 && Number.isFinite(turn)) {
        markExtracted(ccSession, turn, Number.isFinite(lineEnd) ? lineEnd : void 0);
      }
    };
    const raw = readFileSync6(rawFile, "utf8");
    const vocab = buildVocabSnapshot();
    const result = validateExtraction(raw, vocab);
    if (!result.ok) {
      const path = extractorErrorsPath(sessionDbId, (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-"));
      if (!existsSync8(dirname7(path))) mkdirSync6(dirname7(path), { recursive: true });
      writeFileSync4(path, `validation failed: ${result.reason}

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
          console.error("usage: arcadedb-skills config set <server|user|password|memory-db|auto-index> <value>");
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
main().then((c) => process.exit(c)).catch((e) => {
  console.error(e);
  process.exit(1);
});
