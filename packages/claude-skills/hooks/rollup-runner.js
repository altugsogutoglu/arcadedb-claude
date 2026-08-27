#!/usr/bin/env node

// src/rollup-runner.ts
import { unlinkSync as unlinkSync4 } from "node:fs";
import { join as join8 } from "node:path";
import { randomUUID } from "node:crypto";

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

// src/agent-memory/schemas/memory.ts
var EMBEDDING_DIMENSIONS = 384;
var EMBEDDED_TYPES = ["Turn", "Decision", "Insight", "Question", "Answer", "Session", "Digest"];

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
function cypherStr(s) {
  return `'${s.replace(/'/g, "\\'")}'`;
}

// src/env-paths.ts
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
function configDir() {
  return join2(homedir2(), ".config", "arcadedb");
}
function captureLogPath() {
  return join2(configDir(), "capture.log");
}

// src/config.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
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
  if (!existsSync(path)) return {};
  const map = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
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

// src/lock.ts
import { closeSync, openSync, readFileSync as readFileSync2, unlinkSync, writeSync } from "node:fs";
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
    fd = openSync(path, "wx");
  } catch {
    return false;
  }
  try {
    writeSync(fd, String(process.pid));
  } finally {
    closeSync(fd);
  }
  return true;
}
function acquireLock(path) {
  if (createLock(path)) return true;
  let pid = NaN;
  try {
    pid = Number(readFileSync2(path, "utf8").trim());
  } catch {
    return false;
  }
  if (Number.isFinite(pid) && pid > 0 && pidAlive(pid)) return false;
  try {
    unlinkSync(path);
  } catch {
    return false;
  }
  return createLock(path);
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

// src/embed-runner.ts
import { unlinkSync as unlinkSync3 } from "node:fs";
import { join as join5 } from "node:path";

// src/embed.ts
import { existsSync as existsSync3, closeSync as closeSync2, openSync as openSync2, statSync, mkdirSync as mkdirSync3, writeFileSync as writeFileSync2, unlinkSync as unlinkSync2 } from "node:fs";
import { createRequire } from "node:module";
import { join as join4 } from "node:path";
import { pathToFileURL } from "node:url";
var EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
var EMBED_MAX_CHARS = 2e3;
var INSTALL_STALE_MS = 30 * 60 * 1e3;
function embedDir() {
  return join4(configDir(), "embed");
}
function isEmbedInstalled(dir = embedDir()) {
  return existsSync3(join4(dir, "node_modules", "@xenova", "transformers", "package.json"));
}
async function loadEmbedder(dir = embedDir()) {
  if (!isEmbedInstalled(dir)) {
    throw new Error(`embedding runtime not installed in ${dir} (run: arcadedb-skills embed install)`);
  }
  const req = createRequire(join4(dir, "package.json"));
  const entry = req.resolve("@xenova/transformers");
  const mod = await import(pathToFileURL(entry).href);
  mod.env.cacheDir = join4(dir, "models");
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

// src/embed-runner.ts
var BATCH = 64;
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
        `SELECT @rid AS rid, ${expr} AS body FROM ${type} WHERE embedding IS NULL${EMBED_WHERE[type] ?? ""} LIMIT ${BATCH}`
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
  const lock = join5(configDir(), "embed.lock");
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

// src/ppr.ts
function personalizedPageRank(graph, seeds, opts = {}) {
  const damping = opts.damping ?? 0.85;
  const iterations = opts.iterations ?? 30;
  const nodes = [...graph.neighbors.keys()];
  if (nodes.length === 0) return /* @__PURE__ */ new Map();
  const seedTotal = [...seeds.values()].reduce((a, b) => a + b, 0) || 1;
  const teleport = /* @__PURE__ */ new Map();
  for (const [n, w] of seeds) if (graph.neighbors.has(n)) teleport.set(n, w / seedTotal);
  if (teleport.size === 0) return /* @__PURE__ */ new Map();
  const weight = opts.nodeWeight ?? (() => 1);
  const outW = /* @__PURE__ */ new Map();
  for (const n of nodes) outW.set(n, (graph.neighbors.get(n) ?? []).reduce((a, m) => a + weight(m), 0));
  let rank = new Map(teleport);
  for (let i = 0; i < iterations; i++) {
    const next = /* @__PURE__ */ new Map();
    for (const [n, t] of teleport) next.set(n, (1 - damping) * t);
    for (const [n, r] of rank) {
      const total = outW.get(n) ?? 0;
      if (total === 0) {
        for (const [s, t] of teleport) next.set(s, (next.get(s) ?? 0) + damping * r * t);
        continue;
      }
      for (const m of graph.neighbors.get(n) ?? []) {
        next.set(m, (next.get(m) ?? 0) + damping * r * (weight(m) / total));
      }
    }
    rank = next;
  }
  return rank;
}
function hubDamping(degree) {
  return (node) => 1 / Math.log2(2 + degree(node));
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
function sqlStr(s) {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
function temporalClause(type, opts) {
  if (opts.asOf) {
    const t = sqlStr(opts.asOf);
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
  const repoClause = opts.repo ? ` AND repo = ${sqlStr(opts.repo)}` : "";
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
           WHERE SEARCH_INDEX(${sqlStr(`${type}[${prop}]`)}, ${sqlStr(lucene)}) = true${scope(type)}
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
      `SELECT @rid AS rid FROM (SELECT expand(in('MENTIONS')) FROM Ref WHERE valueLc IN [${tokens.map(sqlStr).join(",")}])
       WHERE @type = 'Turn'${scope("Turn")} LIMIT ${candidates}`
    ).catch(() => []);
    (lists["ref"] ??= []).push(...remember("Turn", rows.map((r) => r.rid)));
  }
  if (opts.graph !== false) {
    const seeds = fuseRanks(lists).slice(0, candidates);
    if (seeds.length > 0) {
      const ranked = await graphRank(client, db, new Map(seeds.map((s) => [s.key, s.score])), opts.hops ?? 2, typeOf, types, opts);
      if (ranked.length > 0) lists["graph"] = ranked.slice(0, candidates);
    }
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
var GRAPH_EDGES = "'MENTIONS','DURING','COVERS','SUPERSEDES','FOLLOWS'";
var MAX_SUBGRAPH_NODES = 5e3;
async function graphRank(client, db, seeds, hops, typeOf, types, opts) {
  const neighbors = /* @__PURE__ */ new Map();
  const nodeType = /* @__PURE__ */ new Map();
  for (const [rid, t] of typeOf) nodeType.set(rid, t);
  let frontier = [...seeds.keys()];
  const seen = new Set(frontier);
  for (let hop = 0; hop < hops && frontier.length > 0 && seen.size < MAX_SUBGRAPH_NODES; hop++) {
    const next = [];
    for (let i = 0; i < frontier.length; i += 200) {
      const batch = frontier.slice(i, i + 200);
      const rows = await client.query(
        db,
        "sql",
        `SELECT @rid AS rid, @type AS type, both(${GRAPH_EDGES}).@rid AS nbrs, both(${GRAPH_EDGES}).@type AS ntypes FROM [${batch.join(",")}]`
      ).catch(() => []);
      for (const r of rows) {
        nodeType.set(r.rid, r.type);
        const list = neighbors.get(r.rid) ?? [];
        (r.nbrs ?? []).forEach((n, j) => {
          list.push(n);
          nodeType.set(n, r.ntypes?.[j] ?? "?");
          (neighbors.get(n) ?? neighbors.set(n, []).get(n)).push(r.rid);
          if (!seen.has(n)) {
            seen.add(n);
            next.push(n);
          }
        });
        neighbors.set(r.rid, list);
      }
    }
    frontier = next;
  }
  if (neighbors.size === 0) return [];
  for (const [k, v] of neighbors) neighbors.set(k, [...new Set(v)]);
  const degree = (n) => neighbors.get(n)?.length ?? 0;
  const damp = hubDamping(degree);
  const rank = personalizedPageRank({ neighbors }, seeds, { nodeWeight: (n) => nodeType.get(n) === "Ref" ? damp(n) : 1 });
  const wanted = new Set(types);
  const candidates = [...rank.entries()].filter(([rid]) => wanted.has(nodeType.get(rid) ?? "")).sort((a, b) => b[1] - a[1]).slice(0, 200).map(([rid]) => rid);
  if (candidates.length === 0) return [];
  const kept = [];
  for (const t of types) {
    const ofType = candidates.filter((r) => nodeType.get(r) === t);
    if (ofType.length === 0) continue;
    const repoClause = opts.repo ? ` AND repo = ${sqlStr(opts.repo)}` : "";
    const rows = await client.query(
      db,
      "sql",
      `SELECT @rid AS rid FROM ${t} WHERE @rid IN [${ofType.join(",")}]${repoClause}${temporalClause(t, opts)}${t === "Session" ? " AND summary IS NOT NULL AND summary <> ''" : ""}`
    ).catch(() => []);
    const ok = new Set(rows.map((r) => r.rid));
    for (const r of ofType) if (ok.has(r)) {
      kept.push(r);
      typeOf.set(r, t);
    }
  }
  const order = new Map(candidates.map((r, i) => [r, i]));
  return kept.sort((a, b) => order.get(a) - order.get(b));
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
  const sel = "SELECT id, role, repo, ts AS at, text FROM Turn WHERE sessionId = " + sqlStr(hit.sessionId);
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

// src/embed-spawn.ts
import { spawn } from "node:child_process";
import { closeSync as closeSync3, openSync as openSync3 } from "node:fs";
import { join as join7 } from "node:path";

// src/index-spawn.ts
import { createRequire as createRequire2 } from "node:module";
import { basename, dirname as dirname3, join as join6 } from "node:path";
import { fileURLToPath } from "node:url";
function resolveRunner(here, pluginRoot, name = "index-runner") {
  if (pluginRoot) return join6(pluginRoot, "hooks", `${name}.js`);
  if (here.endsWith(".ts")) return join6(dirname3(here), `${name}.ts`);
  const dir = dirname3(here);
  if (basename(dir) === "src" && basename(dirname3(dir)) === "dist") {
    return join6(dir, "..", "..", "hooks", `${name}.js`);
  }
  return join6(dir, `${name}.js`);
}
function runnerPath(name = "index-runner") {
  return resolveRunner(fileURLToPath(import.meta.url), process.env["CLAUDE_PLUGIN_ROOT"] || void 0, name);
}
function runnerArgv(runner, args) {
  const argv = runner.endsWith(".ts") ? [createRequire2(import.meta.url).resolve("tsx/cli"), runner] : [runner];
  argv.push(...args);
  return argv;
}

// src/embed-spawn.ts
function spawnEmbedRunner(args) {
  try {
    const runner = args.runner ?? runnerPath("embed-runner");
    const log = openSync3(join7(configDir(), "embed.log"), "a");
    const argv = runnerArgv(runner, ["--db", args.db]);
    const child = spawn(process.execPath, argv, { detached: true, stdio: ["ignore", log, log], env: process.env });
    closeSync3(log);
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  }
}

// src/rollup-llm.ts
import { spawn as spawn2 } from "node:child_process";
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
  const child = spawn2("claude", args, {
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
function sqlStr2(s) {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
function cypherStr2(s) {
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
     WHERE endedAt IS NULL AND startedAt < ${sqlStr2(iso(cutoff))}`
  ).catch(() => []);
  let closed = 0;
  for (const r of rows) {
    const endedAt = r.last ?? iso(cutoff);
    await deps.client.execute(deps.db, "sql", `UPDATE Session SET endedAt = ${sqlStr2(String(endedAt).replace(" ", "T"))} WHERE id = ${sqlStr2(r.id)}`);
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
      await client.execute(db, "sql", `UPDATE Session SET summary = '', turnCount = ${n} WHERE id = ${sqlStr2(r.id)}`);
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
    `SELECT idx, role, text FROM Turn WHERE sessionId = ${sqlStr2(session.id)} ORDER BY idx ASC`
  );
  const repo = session.repo ?? "unknown";
  const recorded = await client.query(
    db,
    "cypher",
    `MATCH (d:Decision)-[:DURING]->(s:Session {id: ${cypherStr2(session.id)}})
     RETURN d.id AS id, d.summary AS summary, d.rationale AS rationale, d.decidedAt AS decidedAt`
  ).catch(() => []);
  const candidates = await priorDecisionCandidates(deps, repo, session, turns, recorded.map((r) => r.id));
  await client.execute(db, "sql", `UPDATE Session SET rollupAttempts = ${(session.attempts ?? 0) + 1} WHERE id = ${sqlStr2(session.id)}`);
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
    `MATCH (s:Session {id: ${cypherStr2(session.id)}})
     SET s.summary = ${cypherStr2(parsed.summary)}, s.title = ${cypherStr2(parsed.title)},
         s.summarizedAt = datetime(${cypherStr2(now)}), s.summaryModel = ${cypherStr2(deps.model)},
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
      `MATCH (s:Session {id: ${cypherStr2(session.id)}})
       CREATE (d:Decision {id: ${cypherStr2(id)}, summary: ${cypherStr2(d.summary)}, rationale: ${cypherStr2(d.rationale)},
                           decidedAt: datetime(${cypherStr2(now)}), validFrom: datetime(${cypherStr2(validFrom)}), repo: ${cypherStr2(repo)}})
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
         WHERE @rid IN [${hits.map((h) => h.rid).join(",")}] AND validTo IS NULL AND coalesce(validFrom, decidedAt) < ${sqlStr2(String(session.startedAt).replace(" ", "T"))}`
      ).catch(() => []);
      await add(rows);
    }
  }
  if (out.size < CANDIDATE_DECISIONS) {
    const recent = await deps.client.query(
      deps.db,
      "sql",
      `SELECT id, summary, rationale, coalesce(validFrom, decidedAt) AS decidedAt FROM Decision WHERE repo = ${sqlStr2(repo)} AND validTo IS NULL
       AND coalesce(validFrom, decidedAt) < ${sqlStr2(String(session.startedAt).replace(" ", "T"))} ORDER BY validFrom DESC, decidedAt DESC LIMIT ${CANDIDATE_DECISIONS}`
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
    const existing = await client.query(db, "sql", `SELECT createdAt FROM Digest WHERE id = ${sqlStr2(id)}`);
    const newest = b.sessions.map((s) => String(s.summarizedAt)).sort().pop();
    if (existing.length && String(existing[0].createdAt) >= newest) continue;
    const decisions = await client.query(
      db,
      "sql",
      `SELECT id, summary, rationale, coalesce(validFrom, decidedAt) AS decidedAt FROM Decision WHERE repo = ${sqlStr2(b.repo)}
       AND coalesce(validFrom, decidedAt) >= ${sqlStr2(iso(b.week.start))} AND coalesce(validFrom, decidedAt) < ${sqlStr2(iso(b.week.end))} ORDER BY decidedAt ASC`
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
      `MERGE (g:Digest {id: ${cypherStr2(id)}})
       SET g.repo = ${cypherStr2(b.repo)}, g.week = ${cypherStr2(b.week.key)},
           g.periodStart = datetime(${cypherStr2(iso(b.week.start))}), g.periodEnd = datetime(${cypherStr2(iso(b.week.end))}),
           g.title = ${cypherStr2(parsed.title)}, g.text = ${cypherStr2(parsed.text)}, g.sessionCount = ${b.sessions.length},
           g.createdAt = datetime(${cypherStr2(createdAt)}), g.model = ${cypherStr2(deps.model)}, g.embedding = null`
    );
    for (const s of b.sessions) {
      await client.execute(
        db,
        "cypher",
        `MATCH (g:Digest {id: ${cypherStr2(id)}}), (s:Session {id: ${cypherStr2(s.id)}}) MERGE (g)-[:COVERS]->(s)`
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
  const lock = join8(configDir(), "rollup.lock");
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
export {
  closeAbandonedSessions,
  pendingSessions,
  rollupDigests,
  rollupSession,
  runRollup
};
