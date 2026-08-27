#!/usr/bin/env node

// src/embed-runner.ts
import { unlinkSync as unlinkSync3 } from "node:fs";
import { join as join5 } from "node:path";

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

// src/embed.ts
import { existsSync as existsSync2, closeSync as closeSync2, openSync as openSync2, statSync, mkdirSync as mkdirSync2, writeFileSync as writeFileSync2, unlinkSync as unlinkSync2 } from "node:fs";
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
  return existsSync2(join4(dir, "node_modules", "@xenova", "transformers", "package.json"));
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

// src/capture-log.ts
import { appendFileSync, existsSync as existsSync3, mkdirSync as mkdirSync3 } from "node:fs";
import { dirname as dirname2 } from "node:path";
function logCapture(event, fields = {}) {
  try {
    const path = captureLogPath();
    if (!existsSync3(dirname2(path))) mkdirSync3(dirname2(path), { recursive: true });
    appendFileSync(path, JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), event, ...fields }) + "\n");
  } catch {
  }
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
export {
  EMBED_WHERE,
  TEXT_EXPR,
  embedPending
};
