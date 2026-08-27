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
var EMBEDDED_TYPES = ["Turn", "Decision", "Insight", "Question", "Answer", "Session", "Digest"];
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
        { name: "summary", type: "STRING", fullTextIndex: true },
        { name: "title", type: "STRING" },
        { name: "summarizedAt", type: "DATETIME" },
        { name: "summaryModel", type: "STRING" },
        { name: "turnCount", type: "INTEGER" },
        { name: "rollupAttempts", type: "INTEGER" },
        embedding
      ]
    },
    {
      name: "Turn",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "sessionId", type: "STRING", notNull: true },
        { name: "idx", type: "INTEGER", notNull: true },
        { name: "role", type: "STRING", notNull: true },
        { name: "text", type: "STRING", notNull: true, fullTextIndex: true },
        { name: "ts", type: "DATETIME", notNull: true },
        { name: "repo", type: "STRING" },
        embedding
      ]
    },
    {
      name: "Decision",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "summary", type: "STRING", notNull: true, fullTextIndex: true },
        { name: "rationale", type: "STRING", fullTextIndex: true },
        { name: "decidedAt", type: "DATETIME", notNull: true },
        { name: "repo", type: "STRING" },
        // Bi-temporal validity: world time [validFrom, validTo), database time expiredAt. A closed window is
        // a superseded decision; nothing is deleted.
        { name: "validFrom", type: "DATETIME" },
        { name: "validTo", type: "DATETIME" },
        { name: "expiredAt", type: "DATETIME" },
        { name: "supersededBy", type: "STRING" },
        embedding
      ]
    },
    {
      name: "Insight",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "topic", type: "STRING", notNull: true, fullTextIndex: true },
        { name: "text", type: "STRING", notNull: true, fullTextIndex: true },
        { name: "createdAt", type: "DATETIME", notNull: true },
        { name: "repo", type: "STRING" },
        embedding
      ]
    },
    {
      name: "Question",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "text", type: "STRING", notNull: true, fullTextIndex: true },
        { name: "askedAt", type: "DATETIME", notNull: true },
        { name: "repo", type: "STRING" },
        embedding
      ]
    },
    {
      name: "Answer",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "text", type: "STRING", notNull: true, fullTextIndex: true },
        { name: "answeredAt", type: "DATETIME", notNull: true },
        { name: "confidence", type: "FLOAT" },
        embedding
      ]
    },
    {
      // Weekly rollup per repo: one summary over that week's session summaries and decisions.
      name: "Digest",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "repo", type: "STRING", notNull: true },
        { name: "week", type: "STRING", notNull: true },
        { name: "periodStart", type: "DATETIME", notNull: true },
        { name: "periodEnd", type: "DATETIME", notNull: true },
        { name: "title", type: "STRING" },
        { name: "text", type: "STRING", notNull: true, fullTextIndex: true },
        { name: "sessionCount", type: "INTEGER" },
        { name: "createdAt", type: "DATETIME", notNull: true },
        { name: "model", type: "STRING" },
        embedding
      ]
    },
    {
      // Something a Turn refers to by name: a file path, symbol, commit, ticket or URL.
      // Global on purpose (no repo): the same path or class name links turns across repos.
      name: "Ref",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "kind", type: "STRING", notNull: true },
        { name: "value", type: "STRING", notNull: true },
        { name: "valueLc", type: "STRING", notNull: true }
      ]
    }
  ],
  edges: [
    { name: "MENTIONS" },
    { name: "COVERS" },
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

// src/agent-memory/migrations/fulltext.ts
var BATCH = 200;
async function backfillFullText(client, db, type, prop) {
  let done = 0;
  let skip = 0;
  for (; ; ) {
    const rows = await client.query(
      db,
      "sql",
      `SELECT @rid AS rid, ${prop} AS v FROM ${type} WHERE ${prop} IS NOT NULL SKIP ${skip} LIMIT ${BATCH}`
    );
    if (rows.length === 0) break;
    for (const r of rows) {
      if (typeof r.v !== "string") continue;
      const lit = sqlStr(r.v);
      await client.execute(db, "sql", `UPDATE ${r.rid} SET ${prop} = ${lit} + ' '`);
      await client.execute(db, "sql", `UPDATE ${r.rid} SET ${prop} = ${lit}`);
      done += 1;
    }
    skip += rows.length;
    if (rows.length < BATCH) break;
  }
  return done;
}
function sqlStr(s) {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

// src/agent-memory/memory/decisions.ts
async function supersedeDecision(client, db, newId, oldId, at) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const atClause = at ? `datetime(${cypherStr(at)})` : "coalesce(n.validFrom, n.decidedAt)";
  const rows = await client.execute(
    db,
    "cypher",
    `MATCH (n:Decision {id: ${cypherStr(newId)}}), (o:Decision {id: ${cypherStr(oldId)}})
     WHERE n.id <> o.id
     MERGE (n)-[:SUPERSEDES]->(o)
     SET o.validTo = coalesce(o.validTo, ${atClause}),
         o.expiredAt = coalesce(o.expiredAt, datetime(${cypherStr(now)})),
         o.supersededBy = coalesce(o.supersededBy, n.id)
     RETURN o.id AS id`
  );
  return rows.length > 0;
}
async function reconcileDecisions(client, db) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const rows = await client.execute(
    db,
    "cypher",
    `MATCH (n:Decision)-[:SUPERSEDES]->(o:Decision)
     WHERE o.validTo IS NULL
     SET o.validTo = coalesce(n.validFrom, n.decidedAt),
         o.expiredAt = datetime(${cypherStr(now)}),
         o.supersededBy = n.id
     RETURN o.id AS id`
  );
  return rows.length;
}
async function queryDecisions(client, db, filter = {}) {
  const conds = [];
  if (filter.repo) conds.push(`d.repo = ${cypherStr(filter.repo)}`);
  if (filter.asOf) {
    const t = `datetime(${cypherStr(filter.asOf)})`;
    conds.push(`coalesce(d.validFrom, d.decidedAt) <= ${t} AND (d.validTo IS NULL OR d.validTo > ${t})`);
  } else if (!filter.includeSuperseded) {
    conds.push("d.validTo IS NULL");
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = await client.query(
    db,
    "cypher",
    `MATCH (d:Decision) ${where}
     RETURN d.id AS id, d.summary AS summary, d.rationale AS rationale, d.decidedAt AS decidedAt, d.repo AS repo,
            d.validFrom AS validFrom, d.validTo AS validTo, d.expiredAt AS expiredAt, d.supersededBy AS supersededBy
     ORDER BY d.decidedAt DESC`
  );
  return rows.map((r) => ({
    id: r["id"],
    summary: r["summary"] ?? "",
    rationale: r["rationale"] ?? "",
    decidedAt: r["decidedAt"],
    repo: r["repo"] ?? "",
    validFrom: r["validFrom"] ?? null,
    validTo: r["validTo"] ?? null,
    expiredAt: r["expiredAt"] ?? null,
    supersededBy: r["supersededBy"] ?? null
  }));
}
function cypherStr(s) {
  return `'${s.replace(/'/g, "\\'")}'`;
}

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
function setRepo(alias, props, repo) {
  if (!repo || props["repo"] !== void 0) return "";
  return `
SET ${alias}.repo = coalesce(${alias}.repo, ${quote(repo)})`;
}
function buildExtractorCypher(args) {
  const { triple, sessionDbId, naturalKeys, repo } = args;
  const sub = propsClause(triple.subject.label, triple.subject.props, naturalKeys);
  const obj = propsClause(triple.object.label, triple.object.props, naturalKeys);
  const conf = triple.confidence != null ? `,
                r.confidence = ${triple.confidence}` : "";
  return `MERGE (s:${triple.subject.label} ${sub})
  ${onCreate("s", triple.subject.label, triple.subject.props)}${setProps("s", triple.subject.label, triple.subject.props, naturalKeys)}${setRepo("s", triple.subject.props, repo)}
MERGE (o:${triple.object.label} ${obj})
  ${onCreate("o", triple.object.label, triple.object.props)}${setProps("o", triple.object.label, triple.object.props, naturalKeys)}${setRepo("o", triple.object.props, repo)}
MERGE (s)-[r:${triple.verb}]->(o)
  ON CREATE SET r.firstAt = datetime(),
                r.session = ${quote(sessionDbId)},
                r.evidence = ${quote(triple.evidence)}${conf},
                r.count = 1
  ON MATCH  SET r.lastAt = datetime(),
                r.count = coalesce(r.count, 1) + 1
${supersedeClause(triple)}MERGE (sess:Session {id: ${quote(sessionDbId)}})
MERGE (s)-[:DURING]->(sess)`;
}
function supersedeClause(triple) {
  if (triple.verb !== "SUPERSEDES" || triple.subject.label !== "Decision" || triple.object.label !== "Decision") return "";
  return `SET o.validTo = coalesce(o.validTo, s.validFrom, s.decidedAt, datetime()),
    o.expiredAt = coalesce(o.expiredAt, datetime()),
    o.supersededBy = coalesce(o.supersededBy, s.id)
`;
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
    repo: args.repo ?? null,
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
        naturalKeys: vocab.naturalKeys,
        repo: args.repo
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
        naturalKeys: deps.naturalKeys,
        repo: deps.repo
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
  extractor: { env: "ARCADEDB_EXTRACTOR", validate: (v) => v === "off" || v === "live" || v === "dryrun" ? null : "expected off, live or dryrun" },
  rollup: { env: "ARCADEDB_ROLLUP", validate: (v) => v === "on" || v === "off" ? null : "expected on or off" },
  "rollup-model": { env: "ARCADEDB_ROLLUP_MODEL", validate: (v) => v.trim() ? null : "expected a model name" },
  "rollup-transport": { env: "ARCADEDB_ROLLUP_TRANSPORT", validate: (v) => v === "claude" || v === "api" ? null : "expected claude or api" }
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
  io.out(`  ${pad("rollup:", 12)}${pad(cfg.rollup ? `on, ${cfg.rollupModel} via ${cfg.rollupTransport}` : "off", 24)}(${cfg.sources.rollup})`);
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
var BATCH2 = 64;
var TEXT_EXPR = {
  Turn: "text",
  Decision: "ifnull(summary, '') + ' ' + ifnull(rationale, '')",
  Insight: "ifnull(topic, '') + ' ' + ifnull(text, '')",
  Question: "ifnull(text, '')",
  Answer: "ifnull(text, '')",
  Session: "ifnull(title, '') + ' ' + ifnull(summary, '')",
  Digest: "ifnull(title, '') + ' ' + ifnull(text, '')"
};
var EMBED_WHERE = {
  Session: " AND summary IS NOT NULL AND summary <> ''"
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
        `SELECT @rid AS rid, ${expr} AS body FROM ${type} WHERE embedding IS NULL${EMBED_WHERE[type] ?? ""} LIMIT ${BATCH2}`
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
      if (rows.length < BATCH2) break;
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
  Answer: "answeredAt",
  Session: "summarizedAt",
  Digest: "createdAt"
};
var DISPLAY = { Session: "Summary" };
var TEXT_INDEXED = {
  Turn: ["text"],
  Decision: ["summary", "rationale"],
  Insight: ["topic", "text"],
  Question: ["text"],
  Answer: ["text"],
  Session: ["summary"],
  Digest: ["text"]
};
var RRF_K = 60;
var CANDIDATE_FACTOR = 3;
function fuseRanks(lists, k = RRF_K) {
  const acc = /* @__PURE__ */ new Map();
  for (const [name, keys] of Object.entries(lists)) {
    keys.forEach((key, rank) => {
      const cur = acc.get(key) ?? { score: 0, via: [] };
      cur.score += 1 / (k + rank + 1);
      if (!cur.via.includes(name)) cur.via.push(name);
      acc.set(key, cur);
    });
  }
  return [...acc.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.score - a.score);
}
function luceneQuery(query) {
  const tokens = query.split(/\s+/).map((t) => t.replace(/["\\]/g, "").replace(/^[^\w./:#-]+|[^\w./:#-]+$/g, "")).filter((t) => t.length > 1);
  return tokens.map((t) => `"${t}"`).join(" ");
}
function queryTokens(query) {
  return query.split(/\s+/).map((t) => t.replace(/^[^\w./:#-]+|[^\w./:#-]+$/g, "").toLowerCase()).filter((t) => t.length > 2);
}
function sqlStr2(s) {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
function temporalClause(type, opts) {
  if (opts.asOf) {
    const t = sqlStr2(opts.asOf);
    if (type === "Decision") return ` AND coalesce(validFrom, decidedAt) <= ${t} AND (validTo IS NULL OR validTo > ${t})`;
    return ` AND ${AT_EXPR[type]} <= ${t}`;
  }
  if (type === "Decision" && !opts.includeSuperseded) return " AND validTo IS NULL";
  return "";
}
async function hybridSearch(client, db, embed, query, opts = {}) {
  const limit = opts.limit ?? 10;
  const types = opts.types ?? EMBEDDED_TYPES;
  const mode = opts.mode ?? (embed ? "hybrid" : "text");
  const useVector = mode !== "text" && embed !== null;
  const useText = mode !== "vector";
  const candidates = limit * CANDIDATE_FACTOR;
  const repoClause = opts.repo ? ` AND repo = ${sqlStr2(opts.repo)}` : "";
  const scope = (type) => repoClause + temporalClause(type, opts);
  let vecLiteral = null;
  if (useVector) {
    const [vec] = await embed([query]);
    vecLiteral = `[${vec.map((v) => v.toFixed(6)).join(",")}]`;
  }
  const lucene = useText ? luceneQuery(query) : "";
  const tokens = queryTokens(query);
  const lists = {};
  const typeOf = /* @__PURE__ */ new Map();
  const remember = (type, rids) => {
    for (const r of rids) typeOf.set(r, type);
    return rids;
  };
  for (const type of types) {
    if (vecLiteral) {
      const rows = await client.query(
        db,
        "sql",
        `SELECT @rid AS rid, vectorCosineSimilarity(embedding, ${vecLiteral}) AS score
         FROM ${type} WHERE embedding IS NOT NULL${scope(type)} ORDER BY score DESC LIMIT ${candidates}`
      );
      (lists["vector"] ??= []).push(...remember(type, rows.map((r) => r.rid)));
    }
    if (lucene) {
      for (const prop of TEXT_INDEXED[type]) {
        const rows = await client.query(
          db,
          "sql",
          `SELECT @rid AS rid, $score AS score FROM ${type}
           WHERE SEARCH_INDEX(${sqlStr2(`${type}[${prop}]`)}, ${sqlStr2(lucene)}) = true${scope(type)}
           ORDER BY score DESC LIMIT ${candidates}`
        ).catch(() => []);
        (lists["text"] ??= []).push(...remember(type, rows.map((r) => r.rid)));
      }
    }
  }
  if (useText && tokens.length > 0 && types.includes("Turn")) {
    const rows = await client.query(
      db,
      "sql",
      `SELECT @rid AS rid FROM (SELECT expand(in('MENTIONS')) FROM Ref WHERE valueLc IN [${tokens.map(sqlStr2).join(",")}])
       WHERE @type = 'Turn'${scope("Turn")} LIMIT ${candidates}`
    ).catch(() => []);
    (lists["ref"] ??= []).push(...remember("Turn", rows.map((r) => r.rid)));
  }
  const fused = fuseRanks(lists).slice(0, limit);
  const hits = await hydrate(client, db, fused.map((f) => ({ rid: f.key, type: typeOf.get(f.key), score: f.score, via: f.via })));
  const ctx = opts.context ?? 1;
  const rel = opts.related ?? 3;
  for (const h of hits) {
    if (h.type !== "Turn") continue;
    if (ctx > 0) h.context = await turnContext(client, db, h, ctx);
    if (rel > 0) h.related = await relatedTurns(client, db, h.rid, rel);
  }
  return hits;
}
async function hydrate(client, db, items) {
  const byType = /* @__PURE__ */ new Map();
  for (const it of items) (byType.get(it.type) ?? byType.set(it.type, []).get(it.type)).push(it);
  const out = /* @__PURE__ */ new Map();
  for (const [type, group] of byType) {
    const rows = await client.query(
      db,
      "sql",
      `SELECT @rid AS rid, ${TEXT_EXPR[type]} AS body, repo, ${AT_EXPR[type]} AS at, ${type === "Turn" ? "sessionId, idx" : type === "Session" ? "id AS sessionId, null AS idx" : "null AS sessionId, null AS idx"},
              ${type === "Decision" ? "validTo" : "null AS validTo"}
       FROM ${type} WHERE @rid IN [${group.map((g) => g.rid).join(",")}]`
    );
    for (const r of rows) {
      const it = group.find((g) => g.rid === r.rid);
      const hit = { type, score: it.score, via: it.via, text: r.body ?? "", repo: r.repo ?? null, at: r.at ?? null, sessionId: r.sessionId ?? null, rid: r.rid };
      if (r.idx != null) hit.idx = r.idx;
      if (type === "Decision" && r.validTo) {
        hit.superseded = true;
        hit.validTo = String(r.validTo);
      }
      out.set(r.rid, hit);
    }
  }
  return items.map((i) => out.get(i.rid)).filter((h) => !!h);
}
async function turnContext(client, db, hit, n) {
  const idx = hit.idx;
  if (!hit.sessionId || idx == null) return { before: [], after: [] };
  const sel = "SELECT id, role, repo, ts AS at, text FROM Turn WHERE sessionId = " + sqlStr2(hit.sessionId);
  const before = await client.query(db, "sql", `${sel} AND idx < ${idx} ORDER BY idx DESC LIMIT ${n}`);
  const after = await client.query(db, "sql", `${sel} AND idx > ${idx} ORDER BY idx ASC LIMIT ${n}`);
  return { before: before.reverse(), after };
}
async function relatedTurns(client, db, rid, n) {
  const rows = await client.query(
    db,
    "sql",
    `SELECT id, role, repo, ts AS at, text, sessionId FROM (
       SELECT expand(out('MENTIONS').in('MENTIONS')) FROM ${rid}
     ) WHERE @rid <> ${rid} ORDER BY ts DESC LIMIT ${n * 10}`
  ).catch(() => []);
  const own = await client.query(db, "sql", `SELECT sessionId FROM ${rid}`).catch(() => []);
  const ownSession = own[0]?.sessionId;
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const r of rows) {
    if (r.sessionId === ownSession || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ id: r.id, role: r.role, repo: r.repo, at: r.at, text: r.text });
    if (out.length >= n) break;
  }
  return out;
}
function formatHits(hits, maxChars = 400) {
  if (hits.length === 0) return "no matches (nothing captured or indexed yet)";
  const clip = (t, n) => (t.length > n ? t.slice(0, n) + "..." : t).replace(/\n/g, " ");
  return hits.map((h, i) => {
    const text = h.text.length > maxChars ? h.text.slice(0, maxChars) + "..." : h.text;
    const meta = [DISPLAY[h.type] ?? h.type, h.repo, h.at ? h.at.slice(0, 16) : null, h.via.join("+"), h.superseded ? `superseded ${String(h.validTo).slice(0, 10)}` : null].filter(Boolean).join(" | ");
    const lines = [`${i + 1}. [${h.score.toFixed(3)}] ${meta}`, `   ${text.replace(/\n/g, "\n   ")}`];
    for (const b of h.context?.before ?? []) lines.push(`   \u2191 ${b.role ?? "?"}: ${clip(b.text, 120)}`);
    for (const a of h.context?.after ?? []) lines.push(`   \u2193 ${a.role ?? "?"}: ${clip(a.text, 120)}`);
    for (const r of h.related ?? []) lines.push(`   ~ ${r.repo ?? "?"} ${r.at ? r.at.slice(0, 10) : ""}: ${clip(r.text, 120)}`);
    return lines.join("\n");
  }).join("\n");
}

// src/refs.ts
var MAX_REFS_PER_TURN = 30;
var URL_RE = /https?:\/\/[^\s)>\]"'`]+/g;
var PATH_RE = /(?:^|[\s(`'"[])((?:\.{0,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.[a-z0-9]{1,6})(?=[\s)`'":,;\]]|$)/gi;
var SHA_RE = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g;
var TICKET_RE = /\b([A-Z][A-Z0-9]{1,9})[-:](\d{1,6})\b/g;
var SYMBOL_RE = /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b/g;
var TICKET_PREFIX_NOISE = /* @__PURE__ */ new Set(["UTF", "ISO", "SHA", "MD", "HTTP", "TLS", "SSL", "AES", "RSA", "IPV", "ES", "PHP", "H", "P", "V"]);
function extractRefs(text) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  const push = (kind, raw) => {
    const value = raw.trim();
    if (!value) return;
    const key = `${kind}:${value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, value });
  };
  for (const m of text.matchAll(URL_RE)) push("url", m[0].replace(/[.,;:]+$/, ""));
  const noUrls = text.replace(URL_RE, " ");
  for (const m of noUrls.matchAll(PATH_RE)) push("path", m[1].replace(/^\.\//, ""));
  for (const m of noUrls.matchAll(SHA_RE)) push("commit", m[0].toLowerCase());
  for (const m of noUrls.matchAll(TICKET_RE)) {
    if (TICKET_PREFIX_NOISE.has(m[1])) continue;
    push("ticket", `${m[1]}:${m[2]}`);
  }
  for (const m of noUrls.matchAll(SYMBOL_RE)) {
    if (m[0].length < 6) continue;
    push("symbol", m[0]);
  }
  return out.slice(0, MAX_REFS_PER_TURN);
}
function refId(ref) {
  return `${ref.kind}:${ref.value.toLowerCase()}`;
}

// src/turn-capture.ts
async function writeRefs(client, db, turnId, refs) {
  for (const r of refs) {
    const id = refId(r);
    await client.execute(
      db,
      "cypher",
      `MERGE (r:Ref {id: ${cypherStr2(id)}})
       SET r.kind = ${cypherStr2(r.kind)}, r.value = ${cypherStr2(r.value)}, r.valueLc = ${cypherStr2(r.value.toLowerCase())}`
    );
    await client.execute(
      db,
      "cypher",
      `MATCH (t:Turn {id: ${cypherStr2(turnId)}}), (r:Ref {id: ${cypherStr2(id)}})
       WHERE NOT (t)-[:MENTIONS]->(r) CREATE (t)-[:MENTIONS]->(r)`
    );
  }
  return refs.length;
}
async function backfillRefs(client, db) {
  let turns = 0;
  let refs = 0;
  const rows = await client.query(
    db,
    "cypher",
    `MATCH (t:Turn) WHERE NOT (t)-[:MENTIONS]->() RETURN t.id AS id, t.text AS text`
  );
  for (const row of rows) {
    const found = extractRefs(row.text ?? "");
    if (found.length === 0) continue;
    refs += await writeRefs(client, db, row.id, found);
    turns += 1;
  }
  return { turns, refs };
}
function cypherStr2(s) {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

// src/rollup-runner.ts
import { unlinkSync as unlinkSync4 } from "node:fs";
import { join as join10 } from "node:path";
import { randomUUID } from "node:crypto";

// src/embed-spawn.ts
import { spawn as spawn2 } from "node:child_process";
import { closeSync as closeSync3, openSync as openSync3 } from "node:fs";
import { join as join9 } from "node:path";
function spawnEmbedRunner(args) {
  try {
    const runner = args.runner ?? runnerPath("embed-runner");
    const log = openSync3(join9(configDir(), "embed.log"), "a");
    const argv = runnerArgv(runner, ["--db", args.db]);
    const child = spawn2(process.execPath, argv, { detached: true, stdio: ["ignore", log, log], env: process.env });
    closeSync3(log);
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  }
}

// src/rollup-llm.ts
import { spawn as spawn3 } from "node:child_process";
var claudeTransport = (call) => new Promise((resolve, reject) => {
  const args = [
    "-p",
    "--model",
    call.model,
    "--output-format",
    "json",
    "--no-session-persistence",
    "--tools",
    "",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--system-prompt",
    call.system
  ];
  const child = spawn3("claude", args, {
    env: { ...process.env, ARCADEDB_HOOKS: "off", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => {
    out += d;
  });
  child.stderr.on("data", (d) => {
    err += d;
  });
  child.on("error", reject);
  child.on("close", (code) => {
    if (code !== 0) return reject(new Error(`claude -p exited ${code}: ${err.trim().slice(0, 300)}`));
    let parsed;
    try {
      parsed = JSON.parse(out);
    } catch {
      return reject(new Error(`claude -p returned non-JSON: ${out.slice(0, 200)}`));
    }
    if (parsed.is_error || typeof parsed.result !== "string") return reject(new Error(`claude -p error: ${String(parsed.result).slice(0, 300)}`));
    if (/not logged in/i.test(parsed.result)) return reject(new Error("claude -p: not logged in (run `claude` once, or set ARCADEDB_ROLLUP_TRANSPORT=api with ANTHROPIC_API_KEY)"));
    resolve({
      text: parsed.result,
      costUsd: typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : null,
      inputTokens: parsed.usage?.input_tokens ?? null,
      outputTokens: parsed.usage?.output_tokens ?? null
    });
  });
  child.stdin.end(call.prompt);
});
var MODEL_ALIASES = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-5"
};
var apiTransport = async (call) => {
  const key = process.env["ANTHROPIC_API_KEY"];
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set (ARCADEDB_ROLLUP_TRANSPORT=api)");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL_ALIASES[call.model] ?? call.model,
      max_tokens: call.maxTokens ?? 2048,
      system: call.system,
      messages: [{ role: "user", content: call.prompt }]
    })
  });
  if (!res.ok) throw new Error(`Messages API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const text = (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  return { text, costUsd: null, inputTokens: body.usage?.input_tokens ?? null, outputTokens: body.usage?.output_tokens ?? null };
};
function selectTransport(name) {
  return name === "api" ? apiTransport : claudeTransport;
}

// src/rollup.ts
var MAX_TRANSCRIPT_CHARS = 24e3;
var MIN_TURNS_FOR_ROLLUP = 4;
var MAX_DECISIONS_PER_SESSION = 5;
var MAX_ROLLUP_ATTEMPTS = 3;
function clipTranscript(turns, maxChars = MAX_TRANSCRIPT_CHARS) {
  const lines = turns.map((t) => `[${t.idx}] ${t.role}: ${t.text.trim()}`);
  const full = lines.join("\n\n");
  if (full.length <= maxChars) return full;
  const headBudget = Math.floor(maxChars * 0.6);
  const tailBudget = maxChars - headBudget;
  const head = [];
  let used = 0;
  for (const l of lines) {
    if (used + l.length + 2 > headBudget) break;
    head.push(l);
    used += l.length + 2;
  }
  const tail = [];
  used = 0;
  for (let i = lines.length - 1; i >= head.length; i--) {
    const l = lines[i];
    if (used + l.length + 2 > tailBudget) break;
    tail.unshift(l);
    used += l.length + 2;
  }
  const cut = lines.length - head.length - tail.length;
  return [...head, `[... ${cut} turns omitted ...]`, ...tail].join("\n\n");
}
var SESSION_SYSTEM_PROMPT = "You summarise one Claude Code session for a developer's long-term memory graph. Answer with strict JSON only, no prose, no markdown fences.";
function buildSessionPrompt(input) {
  const fmt = (d) => `- id=${d.id} (${d.decidedAt.slice(0, 10)}): ${d.summary}${d.rationale ? ` \u2014 ${d.rationale}` : ""}`;
  return [
    `Repo: ${input.repo}`,
    `Session: ${input.startedAt.slice(0, 16)} to ${(input.endedAt ?? "").slice(0, 16) || "?"}, ${input.turns.length} turns.`,
    "",
    "TRANSCRIPT (user prompts and assistant answers, tool output omitted):",
    clipTranscript(input.turns),
    "",
    input.recorded.length ? "DECISIONS ALREADY RECORDED FOR THIS SESSION (do not repeat them):\n" + input.recorded.map(fmt).join("\n") : "DECISIONS ALREADY RECORDED FOR THIS SESSION: none",
    "",
    input.candidates.length ? "PRIOR DECISIONS OF THIS REPO THAT MIGHT NOW BE REPLACED (use their id in `supersedes` only when this session clearly reversed or replaced them):\n" + input.candidates.map(fmt).join("\n") : "PRIOR DECISIONS OF THIS REPO: none",
    "",
    "Return JSON with exactly this shape:",
    "{",
    '  "title": "<= 80 chars, what the session was about",',
    '  "summary": "markdown, <= 1200 chars, sections: **Outcome**, **Changed** (files, commits, versions), **Decided** (with why), **Open** (unfinished, blockers)",',
    `  "decisions": [ up to ${MAX_DECISIONS_PER_SESSION} NEW durable decisions: {"summary": "<= 160 chars", "rationale": "<= 300 chars", "supersedes": ["<prior id>"]} ]`,
    "}",
    "Rules: decisions are choices with lasting effect (architecture, library, process, naming), not tasks done. Empty `decisions` is a good answer for a session without one. `supersedes` ids must come from the prior list."
  ].join("\n");
}
var DIGEST_SYSTEM_PROMPT = "You write a weekly digest of a developer's work on one repository from that week's session summaries, for a long-term memory graph. Answer with strict JSON only, no prose, no markdown fences.";
function buildDigestPrompt(input) {
  const sessions = input.sessions.map((s) => `### ${s.startedAt.slice(0, 16)}${s.title ? ` \u2014 ${s.title}` : ""}
${s.summary.trim()}`).join("\n\n");
  const decisions = input.decisions.length ? input.decisions.map((d) => `- ${d.decidedAt.slice(0, 10)}: ${d.summary}${d.rationale ? ` \u2014 ${d.rationale}` : ""}`).join("\n") : "none";
  return [
    `Repo: ${input.repo}. Week ${input.week} (${input.periodStart.slice(0, 10)} to ${input.periodEnd.slice(0, 10)}), ${input.sessions.length} sessions.`,
    "",
    "SESSION SUMMARIES:",
    sessions,
    "",
    "DECISIONS RECORDED THIS WEEK:",
    decisions,
    "",
    "Return JSON with exactly this shape:",
    '{ "title": "<= 80 chars", "text": "markdown, <= 2000 chars, sections: **Shipped**, **Decided**, **Learned**, **Open**; keep commit ids, file paths and version numbers" }'
  ].join("\n");
}
function parseSessionRollup(raw) {
  const obj = parseJsonObject(raw);
  if (!obj) return null;
  const title = str(obj["title"], 120);
  const summary = str(obj["summary"], 4e3);
  if (!title || !summary) return null;
  const decisions = [];
  const list = Array.isArray(obj["decisions"]) ? obj["decisions"] : [];
  for (const d of list.slice(0, MAX_DECISIONS_PER_SESSION)) {
    if (!d || typeof d !== "object") continue;
    const rec = d;
    const s = str(rec["summary"], 300);
    if (!s) continue;
    const supersedes = Array.isArray(rec["supersedes"]) ? rec["supersedes"].filter((x) => typeof x === "string" && x.length > 0) : [];
    decisions.push({ summary: s, rationale: str(rec["rationale"], 600) ?? "", supersedes });
  }
  return { title, summary, decisions };
}
function parseDigest(raw) {
  const obj = parseJsonObject(raw);
  if (!obj) return null;
  const title = str(obj["title"], 120);
  const text = str(obj["text"], 6e3);
  if (!title || !text) return null;
  return { title, text };
}
function parseJsonObject(raw) {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const v = JSON.parse(trimmed.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
function str(v, max) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.length > max ? t.slice(0, max) : t : null;
}
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - day + 1);
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 864e5 + 1) / 7);
  const end = new Date(monday);
  end.setUTCDate(monday.getUTCDate() + 7);
  return { key: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`, start: monday, end };
}
function digestId(repo, weekKey) {
  return `${repo}:${weekKey}`;
}

// src/rollup-runner.ts
var ABANDON_AFTER_MS = 6 * 60 * 60 * 1e3;
var CANDIDATE_DECISIONS = 8;
function sqlStr3(s) {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
function cypherStr3(s) {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
function iso(d) {
  return d.toISOString();
}
async function closeAbandonedSessions(deps) {
  const now = (deps.now ?? (() => /* @__PURE__ */ new Date()))();
  const cutoff = new Date(now.getTime() - ABANDON_AFTER_MS);
  const rows = await deps.client.query(
    deps.db,
    "sql",
    `SELECT id, (SELECT max(ts) FROM Turn WHERE sessionId = $parent.$current.id) AS last FROM Session
     WHERE endedAt IS NULL AND startedAt < ${sqlStr3(iso(cutoff))}`
  ).catch(() => []);
  let closed = 0;
  for (const r of rows) {
    const endedAt = r.last ?? iso(cutoff);
    await deps.client.execute(deps.db, "sql", `UPDATE Session SET endedAt = ${sqlStr3(String(endedAt).replace(" ", "T"))} WHERE id = ${sqlStr3(r.id)}`);
    closed += 1;
  }
  return closed;
}
var LLM_BATCH = 20;
async function pendingSessions(client, db) {
  const rows = await client.query(
    db,
    "sql",
    `SELECT id, repo, startedAt, endedAt, rollupAttempts AS attempts FROM Session
     WHERE endedAt IS NOT NULL AND summary IS NULL AND (rollupAttempts IS NULL OR rollupAttempts < ${MAX_ROLLUP_ATTEMPTS})
     ORDER BY endedAt ASC`
  );
  if (rows.length === 0) return [];
  const counts = /* @__PURE__ */ new Map();
  for (const c of await client.query(db, "sql", "SELECT sessionId, count(*) AS n FROM Turn GROUP BY sessionId")) {
    counts.set(c.sessionId, Number(c.n));
  }
  const out = [];
  let budget = LLM_BATCH;
  for (const r of rows) {
    const n = counts.get(r.id) ?? 0;
    if (n < MIN_TURNS_FOR_ROLLUP) {
      await client.execute(db, "sql", `UPDATE Session SET summary = '', turnCount = ${n} WHERE id = ${sqlStr3(r.id)}`);
      out.push({ ...r, turnCount: n });
      continue;
    }
    if (budget > 0) {
      out.push({ ...r, turnCount: n });
      budget -= 1;
    }
  }
  return out;
}
async function rollupSession(deps, session, stats) {
  const { client, db } = deps;
  if (session.turnCount < MIN_TURNS_FOR_ROLLUP) {
    stats.skipped += 1;
    return;
  }
  const turns = await client.query(
    db,
    "sql",
    `SELECT idx, role, text FROM Turn WHERE sessionId = ${sqlStr3(session.id)} ORDER BY idx ASC`
  );
  const repo = session.repo ?? "unknown";
  const recorded = await client.query(
    db,
    "cypher",
    `MATCH (d:Decision)-[:DURING]->(s:Session {id: ${cypherStr3(session.id)}})
     RETURN d.id AS id, d.summary AS summary, d.rationale AS rationale, d.decidedAt AS decidedAt`
  ).catch(() => []);
  const candidates = await priorDecisionCandidates(deps, repo, session, turns, recorded.map((r) => r.id));
  await client.execute(db, "sql", `UPDATE Session SET rollupAttempts = ${(session.attempts ?? 0) + 1} WHERE id = ${sqlStr3(session.id)}`);
  const prompt = buildSessionPrompt({ repo, startedAt: String(session.startedAt), endedAt: session.endedAt ? String(session.endedAt) : null, turns, recorded, candidates });
  const res = await deps.llm({ system: SESSION_SYSTEM_PROMPT, prompt, model: deps.model, maxTokens: 2048 });
  stats.costUsd += res.costUsd ?? 0;
  const parsed = parseSessionRollup(res.text);
  if (!parsed) {
    stats.failed += 1;
    logCapture("rollup_invalid", { session: session.id, sample: res.text.slice(0, 200) });
    return;
  }
  const now = iso((deps.now ?? (() => /* @__PURE__ */ new Date()))());
  await client.execute(
    db,
    "cypher",
    `MATCH (s:Session {id: ${cypherStr3(session.id)}})
     SET s.summary = ${cypherStr3(parsed.summary)}, s.title = ${cypherStr3(parsed.title)},
         s.summarizedAt = datetime(${cypherStr3(now)}), s.summaryModel = ${cypherStr3(deps.model)},
         s.turnCount = ${turns.length}, s.embedding = null`
  );
  stats.summarized += 1;
  const known = new Set(candidates.map((c) => c.id));
  const validFrom = String(session.startedAt).replace(" ", "T");
  for (const d of parsed.decisions) {
    const id = randomUUID();
    await client.execute(
      db,
      "cypher",
      `MATCH (s:Session {id: ${cypherStr3(session.id)}})
       CREATE (d:Decision {id: ${cypherStr3(id)}, summary: ${cypherStr3(d.summary)}, rationale: ${cypherStr3(d.rationale)},
                           decidedAt: datetime(${cypherStr3(now)}), validFrom: datetime(${cypherStr3(validFrom)}), repo: ${cypherStr3(repo)}})
       CREATE (d)-[:DURING]->(s)`
    );
    stats.decisions += 1;
    for (const old of d.supersedes) {
      if (!known.has(old)) continue;
      if (await supersedeDecision(client, db, id, old, validFrom)) stats.superseded += 1;
    }
  }
}
async function priorDecisionCandidates(deps, repo, session, turns, exclude) {
  const probe = turns.filter((t) => t.role === "user").map((t) => t.text.slice(0, 200)).join(" ").slice(0, 1500);
  const out = /* @__PURE__ */ new Map();
  const add = async (rows) => {
    for (const r of rows) if (!exclude.includes(r.id) && !out.has(r.id)) out.set(r.id, r);
  };
  if (probe.trim()) {
    const hits = await hybridSearch(deps.client, deps.db, null, probe, { limit: CANDIDATE_DECISIONS, types: ["Decision"], repo, mode: "text", context: 0, related: 0 }).catch(() => []);
    if (hits.length) {
      const rows = await deps.client.query(
        deps.db,
        "sql",
        `SELECT id, summary, rationale, coalesce(validFrom, decidedAt) AS decidedAt FROM Decision
         WHERE @rid IN [${hits.map((h) => h.rid).join(",")}] AND validTo IS NULL AND coalesce(validFrom, decidedAt) < ${sqlStr3(String(session.startedAt).replace(" ", "T"))}`
      ).catch(() => []);
      await add(rows);
    }
  }
  if (out.size < CANDIDATE_DECISIONS) {
    const recent = await deps.client.query(
      deps.db,
      "sql",
      `SELECT id, summary, rationale, coalesce(validFrom, decidedAt) AS decidedAt FROM Decision WHERE repo = ${sqlStr3(repo)} AND validTo IS NULL
       AND coalesce(validFrom, decidedAt) < ${sqlStr3(String(session.startedAt).replace(" ", "T"))} ORDER BY validFrom DESC, decidedAt DESC LIMIT ${CANDIDATE_DECISIONS}`
    ).catch(() => []);
    await add(recent);
  }
  return [...out.values()].slice(0, CANDIDATE_DECISIONS);
}
async function rollupDigests(deps, stats) {
  const { client, db } = deps;
  const now = (deps.now ?? (() => /* @__PURE__ */ new Date()))();
  const sessions = await client.query(
    db,
    "sql",
    `SELECT id, repo, startedAt, title, summary, summarizedAt FROM Session
     WHERE summary IS NOT NULL AND summary <> '' AND repo IS NOT NULL ORDER BY startedAt ASC`
  );
  const buckets = /* @__PURE__ */ new Map();
  for (const s of sessions) {
    const started = new Date(String(s.startedAt).replace(" ", "T"));
    const week = isoWeek(started);
    if (week.end.getTime() > now.getTime()) continue;
    const key = digestId(s.repo, week.key);
    const b = buckets.get(key) ?? { repo: s.repo, week, sessions: [] };
    b.sessions.push(s);
    buckets.set(key, b);
  }
  for (const [id, b] of buckets) {
    const existing = await client.query(db, "sql", `SELECT createdAt FROM Digest WHERE id = ${sqlStr3(id)}`);
    const newest = b.sessions.map((s) => String(s.summarizedAt)).sort().pop();
    if (existing.length && String(existing[0].createdAt) >= newest) continue;
    const decisions = await client.query(
      db,
      "sql",
      `SELECT id, summary, rationale, coalesce(validFrom, decidedAt) AS decidedAt FROM Decision WHERE repo = ${sqlStr3(b.repo)}
       AND coalesce(validFrom, decidedAt) >= ${sqlStr3(iso(b.week.start))} AND coalesce(validFrom, decidedAt) < ${sqlStr3(iso(b.week.end))} ORDER BY decidedAt ASC`
    ).catch(() => []);
    const prompt = buildDigestPrompt({
      repo: b.repo,
      week: b.week.key,
      periodStart: iso(b.week.start),
      periodEnd: iso(b.week.end),
      sessions: b.sessions.map((s) => ({ id: s.id, startedAt: String(s.startedAt), title: s.title, summary: s.summary })),
      decisions
    });
    const res = await deps.llm({ system: DIGEST_SYSTEM_PROMPT, prompt, model: deps.model, maxTokens: 3e3 });
    stats.costUsd += res.costUsd ?? 0;
    const parsed = parseDigest(res.text);
    if (!parsed) {
      stats.failed += 1;
      logCapture("digest_invalid", { digest: id, sample: res.text.slice(0, 200) });
      continue;
    }
    const createdAt = iso((deps.now ?? (() => /* @__PURE__ */ new Date()))());
    await client.execute(
      db,
      "cypher",
      `MERGE (g:Digest {id: ${cypherStr3(id)}})
       SET g.repo = ${cypherStr3(b.repo)}, g.week = ${cypherStr3(b.week.key)},
           g.periodStart = datetime(${cypherStr3(iso(b.week.start))}), g.periodEnd = datetime(${cypherStr3(iso(b.week.end))}),
           g.title = ${cypherStr3(parsed.title)}, g.text = ${cypherStr3(parsed.text)}, g.sessionCount = ${b.sessions.length},
           g.createdAt = datetime(${cypherStr3(createdAt)}), g.model = ${cypherStr3(deps.model)}, g.embedding = null`
    );
    for (const s of b.sessions) {
      await client.execute(
        db,
        "cypher",
        `MATCH (g:Digest {id: ${cypherStr3(id)}}), (s:Session {id: ${cypherStr3(s.id)}}) MERGE (g)-[:COVERS]->(s)`
      );
    }
    stats.digests += 1;
  }
}
async function runRollup(deps) {
  const stats = { closed: 0, summarized: 0, skipped: 0, failed: 0, decisions: 0, superseded: 0, digests: 0, costUsd: 0 };
  stats.closed = await closeAbandonedSessions(deps);
  for (const s of await pendingSessions(deps.client, deps.db)) {
    try {
      await rollupSession(deps, s, stats);
    } catch (err) {
      stats.failed += 1;
      logCapture("rollup_failed", { session: s.id, error: err?.message ?? String(err) });
    }
  }
  try {
    await rollupDigests(deps, stats);
  } catch (err) {
    stats.failed += 1;
    logCapture("digest_failed", { error: err?.message ?? String(err) });
  }
  return stats;
}
function flag2(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? void 0 : argv[i + 1];
}
async function main2() {
  const db = flag2(process.argv, "db");
  if (!db) {
    console.error("usage: rollup-runner --db <name>");
    process.exit(2);
  }
  const cfg = resolveConfig();
  if (!cfg.rollup) {
    logCapture("rollup_skip", { reason: "off", db });
    return;
  }
  const lock = join10(configDir(), "rollup.lock");
  if (!acquireLock(lock)) {
    logCapture("rollup_skip", { reason: "locked", db });
    return;
  }
  const started = Date.now();
  try {
    const client = new Client(toClientEnv(cfg), { timeoutMs: 3e4 });
    const stats = await runRollup({ client, db, model: cfg.rollupModel, llm: selectTransport(cfg.rollupTransport) });
    if (stats.summarized || stats.digests || stats.failed || stats.closed) {
      logCapture("rollup_done", { db, ...stats, costUsd: Number(stats.costUsd.toFixed(4)), ms: Date.now() - started });
    }
    if ((stats.summarized || stats.digests) && cfg.embed && isEmbedInstalled()) spawnEmbedRunner({ db });
  } catch (err) {
    logCapture("rollup_failed", { db, error: err?.message ?? String(err) });
    process.exitCode = 1;
  } finally {
    try {
      unlinkSync4(lock);
    } catch {
    }
  }
}
var isEntry2 = process.argv[1] !== void 0 && /rollup-runner\.(?:js|ts)$/.test(process.argv[1]);
if (isEntry2) {
  main2().catch((err) => {
    logCapture("rollup_failed", { error: err?.message ?? String(err) });
    process.exit(1);
  });
}

// bin/arcadedb-skills.ts
function flag3(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? void 0 : argv[i + 1];
}
function usage() {
  console.error("usage: arcadedb-skills <command> [options]");
  console.error("commands:");
  console.error("  mark-extracted --session <id> --turn <n>   update session state after extractor finishes");
  console.error("  extractor-prompt                           print the extractor system prompt");
  console.error("  extract-write --raw <file> --session <sessionDbId> --cc-session <id> --turns <N..M> --mode <live|dryrun> [--lines <A..B>] [--turn <n>] [--repo <name>]");
  console.error(`  config show | set <${SET_KEY_NAMES}> <value> | test | forget <key> [--drop-db] | index [<key>]`);
  console.error("  search <query> [--limit <n>] [--types Turn,Decision,...] [--repo <name>] [--mode hybrid|vector|text] [--context <n>] [--related <n>] [--json]");
  console.error("      ... [--as-of <ISO>] [--include-superseded]   point-in-time view | show decisions with a closed validity window");
  console.error("  decisions list [--repo <name>] [--all] [--as-of <ISO>] | supersede <newId> <oldId> [--at <ISO>] | reconcile");
  console.error("  rollup run | status | show <sessionDbId>   summarise ended sessions + weekly digests now | pending count | print a summary");
  console.error("  search reindex                             re-index existing rows for full-text search (one-off after upgrade)");
  console.error("  refs backfill | <value>                    link :Ref nodes for old turns | list turns naming a path/symbol/commit/ticket");
  console.error("  embed install | status | run              manage the local embedding runtime");
  console.error("  extract-replay <sessionDbId|audit.jsonl> [--repo <name>]  re-write a session's audited triples into the graph (repairs nodes written without text)");
}
async function main3() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) {
    usage();
    return 1;
  }
  if (cmd === "mark-extracted") {
    const session = flag3(rest, "session");
    const turnArg = flag3(rest, "turn");
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
  if (cmd === "search" && rest[0] === "reindex") {
    const cfg = resolveConfig();
    const client = new Client(toClientEnv(cfg));
    const db = resolveMemoryDb(cfg, loadProjects(projectsJsonPath()));
    const pairs = [["Turn", "text"], ["Decision", "summary"], ["Decision", "rationale"], ["Insight", "topic"], ["Insight", "text"], ["Question", "text"], ["Answer", "text"]];
    for (const [type, prop] of pairs) {
      const n = await backfillFullText(client, db, type, prop);
      console.log(`${type}.${prop}: ${n} rows re-indexed`);
    }
    return 0;
  }
  if (cmd === "search") {
    const VALUE_FLAGS = /* @__PURE__ */ new Set(["--limit", "--types", "--repo", "--mode", "--context", "--related", "--as-of"]);
    const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && VALUE_FLAGS.has(rest[i - 1])));
    const query = positional.join(" ").trim();
    if (!query) {
      console.error("usage: arcadedb-skills search <query> [--limit <n>] [--types Turn,Decision,...] [--repo <name>] [--mode hybrid|vector|text] [--context <n>] [--related <n>] [--json]");
      return 1;
    }
    const mode = flag3(rest, "mode") ?? "hybrid";
    const embedReady = embedStatus() === "ready";
    if (mode === "vector" && !embedReady) {
      console.error(`embedding runtime not ready (${embedStatus()}); run: arcadedb-skills embed install`);
      return 2;
    }
    const limit = Number(flag3(rest, "limit") ?? 10);
    const typesArg = flag3(rest, "types");
    const types = typesArg ? typesArg.split(",").map((t) => t.trim()).filter((t) => EMBEDDED_TYPES.includes(t)) : void 0;
    const cfg = resolveConfig();
    const client = new Client(toClientEnv(cfg));
    const db = resolveMemoryDb(cfg, loadProjects(projectsJsonPath()));
    const embed = embedReady && mode !== "text" ? await loadEmbedder() : null;
    const num = (name, dflt) => {
      const v = Number(flag3(rest, name));
      return Number.isFinite(v) ? v : dflt;
    };
    const hits = await hybridSearch(client, db, embed, query, {
      limit: Number.isFinite(limit) ? limit : 10,
      types,
      repo: flag3(rest, "repo"),
      mode,
      context: num("context", 1),
      related: num("related", 3),
      includeSuperseded: rest.includes("--include-superseded"),
      asOf: flag3(rest, "as-of")
    });
    if (!embedReady && mode === "hybrid") console.error("note: embedding runtime not ready, text-only results (arcadedb-skills embed install)");
    console.log(rest.includes("--json") ? JSON.stringify(hits, null, 2) : formatHits(hits));
    return 0;
  }
  if (cmd === "decisions") {
    const cfg = resolveConfig();
    const client = new Client(toClientEnv(cfg));
    const db = resolveMemoryDb(cfg, loadProjects(projectsJsonPath()));
    const sub = rest[0];
    if (sub === "supersede") {
      const [, newId, oldId] = rest;
      if (!newId || !oldId) {
        console.error("usage: arcadedb-skills decisions supersede <newId> <oldId> [--at <ISO>]");
        return 1;
      }
      const ok = await supersedeDecision(client, db, newId, oldId, flag3(rest, "at"));
      console.log(ok ? `${oldId} superseded by ${newId}` : "no such decisions (both ids must exist and differ)");
      return ok ? 0 : 1;
    }
    if (sub === "reconcile") {
      console.log(`closed ${await reconcileDecisions(client, db)} decision window(s)`);
      return 0;
    }
    const list = await queryDecisions(client, db, { repo: flag3(rest, "repo"), includeSuperseded: rest.includes("--all"), asOf: flag3(rest, "as-of") });
    if (rest.includes("--json")) {
      console.log(JSON.stringify(list, null, 2));
      return 0;
    }
    if (list.length === 0) {
      console.log("no decisions");
      return 0;
    }
    for (const d of list) {
      const window = d.validTo ? `valid ${String(d.validFrom ?? d.decidedAt).slice(0, 10)} \u2192 ${String(d.validTo).slice(0, 10)} (superseded by ${d.supersededBy ?? "?"})` : `since ${String(d.validFrom ?? d.decidedAt).slice(0, 10)}`;
      console.log(`- [${d.repo}] ${d.summary}
    ${window}  id=${d.id}${d.rationale ? `
    ${d.rationale.slice(0, 200)}` : ""}`);
    }
    return 0;
  }
  if (cmd === "rollup") {
    const cfg = resolveConfig();
    const client = new Client(toClientEnv(cfg), { timeoutMs: 3e4 });
    const db = resolveMemoryDb(cfg, loadProjects(projectsJsonPath()));
    const sub = rest[0] ?? "status";
    if (sub === "status") {
      const pending = await pendingSessions(client, db);
      const done = await client.query(db, "sql", "SELECT count(*) AS n FROM Session WHERE summary IS NOT NULL AND summary <> ''");
      const digests = await client.query(db, "sql", "SELECT count(*) AS n FROM Digest");
      const real = pending.filter((x) => x.turnCount >= 4).length;
      console.log(`rollup: ${cfg.rollup ? `on (${cfg.rollupModel} via ${cfg.rollupTransport})` : "off"}; ${done[0]?.n ?? 0} sessions summarised, ${digests[0]?.n ?? 0} weekly digests, ${real} pending (${pending.length - real} too short, skipped)`);
      for (const p of pending.filter((x) => x.turnCount >= 4)) console.log(`  pending: ${p.id} ${p.repo ?? "?"} ${String(p.startedAt).slice(0, 16)} ${p.turnCount} turns, attempts=${p.attempts ?? 0}`);
      return 0;
    }
    if (sub === "run") {
      if (!cfg.rollup && !rest.includes("--force")) {
        console.error("rollup is off (ARCADEDB_ROLLUP=on, or pass --force)");
        return 1;
      }
      const stats = await runRollup({ client, db, model: cfg.rollupModel, llm: selectTransport(cfg.rollupTransport) });
      console.log(JSON.stringify({ ...stats, costUsd: Number(stats.costUsd.toFixed(4)) }));
      return stats.failed ? 1 : 0;
    }
    if (sub === "show") {
      const id = rest[1];
      if (!id) {
        console.error("usage: arcadedb-skills rollup show <sessionDbId|digestId>");
        return 1;
      }
      const s = await client.query(db, "sql", `SELECT title, summary, repo, startedAt, summaryModel FROM Session WHERE id = '${id.replace(/'/g, "")}'`);
      if (s[0]) {
        console.log(`# ${s[0].title ?? "(untitled)"}
${s[0].repo} ${String(s[0].startedAt).slice(0, 16)} (${s[0].summaryModel ?? "?"})

${s[0].summary || "(no summary yet)"}`);
        return 0;
      }
      const g = await client.query(db, "sql", `SELECT title, text, week, repo FROM Digest WHERE id = '${id.replace(/'/g, "")}'`);
      if (g[0]) {
        console.log(`# ${g[0].title}
${g[0].repo} ${g[0].week}

${g[0].text}`);
        return 0;
      }
      console.error("no session or digest with that id");
      return 1;
    }
    console.error("usage: arcadedb-skills rollup run | status | show <id>");
    return 1;
  }
  if (cmd === "refs") {
    const cfg = resolveConfig();
    const client = new Client(toClientEnv(cfg));
    const db = resolveMemoryDb(cfg, loadProjects(projectsJsonPath()));
    if (rest[0] === "backfill") {
      const r = await backfillRefs(client, db);
      console.log(`linked ${r.refs} refs on ${r.turns} turns`);
      return 0;
    }
    const value = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1] === "--limit")).join(" ").trim().toLowerCase();
    if (!value) {
      console.error("usage: arcadedb-skills refs backfill | <path|symbol|commit|ticket> [--limit <n>] [--json]");
      return 1;
    }
    const lim = Number(flag3(rest, "limit") ?? 20);
    const rows = await client.query(
      db,
      "cypher",
      `MATCH (r:Ref)<-[:MENTIONS]-(t:Turn) WHERE r.valueLc = '${value.replace(/'/g, "\\'")}'
       RETURN r.kind AS kind, r.value AS value, t.id AS id, t.repo AS repo, t.ts AS at, t.role AS role, t.text AS text
       ORDER BY t.ts DESC LIMIT ${Number.isFinite(lim) ? lim : 20}`
    );
    if (rest.includes("--json")) {
      console.log(JSON.stringify(rows, null, 2));
      return 0;
    }
    if (rows.length === 0) {
      console.log(`no turns mention "${value}"`);
      return 0;
    }
    console.log(`${rows.length} turn(s) mention ${rows[0].kind} ${rows[0].value}:`);
    for (const r of rows) console.log(`- ${r.repo ?? "?"} ${String(r.at).slice(0, 16)} ${r.role}: ${(r.text ?? "").replace(/\n/g, " ").slice(0, 160)}`);
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
    let sessionDbId = flag3(rest, "session");
    let repo = flag3(rest, "repo") ?? null;
    for (const line of readFileSync7(auditPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.kind === "batch" && entry.sessionDbId && !sessionDbId) sessionDbId = entry.sessionDbId;
      if (entry.kind === "batch" && entry.repo && !repo) repo = entry.repo;
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
      sessionDbId,
      repo
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
    const rawFile = flag3(rest, "raw");
    const sessionDbId = flag3(rest, "session");
    const ccSession = flag3(rest, "cc-session");
    const turns = flag3(rest, "turns");
    const mode = (flag3(rest, "mode") ?? "live").toLowerCase();
    if (!rawFile || !sessionDbId || !ccSession || !turns) {
      console.error("usage: arcadedb-skills extract-write --raw <file> --session <sessionDbId> --cc-session <id> --turns <N..M> --mode <live|dryrun>");
      return 1;
    }
    const lines = flag3(rest, "lines");
    const turnArg = flag3(rest, "turn");
    const turn = turnArg === void 0 ? void 0 : Number(turnArg);
    const lineEnd = lines ? Number(lines.split("..")[1]) : void 0;
    const markIfRequested = () => {
      if (turn !== void 0 && Number.isFinite(turn)) {
        markExtracted(ccSession, turn, Number.isFinite(lineEnd) ? lineEnd : void 0);
      }
    };
    const raw = readFileSync7(rawFile, "utf8");
    const vocab = buildVocabSnapshot();
    const repo = flag3(rest, "repo") ?? readSessionState(ccSession)?.repo ?? null;
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
      repo,
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
          sessionDbId,
          repo
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
main3().then((c) => process.exit(c)).catch((e) => {
  console.error(e);
  process.exit(1);
});
