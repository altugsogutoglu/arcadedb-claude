#!/usr/bin/env node

// src/index-runner.ts
import { existsSync as existsSync5, readFileSync as readFileSync4, writeFileSync as writeFileSync3, unlinkSync, openSync, writeSync, closeSync, realpathSync as realpathSync2 } from "node:fs";
import { execSync } from "node:child_process";
import { join as join10 } from "node:path";
import { fileURLToPath } from "node:url";

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
  async query(db, language, q2) {
    const data = await this.post(`/api/v1/query/${db}`, { language, command: q2 });
    return data.result;
  }
  async execute(db, language, q2) {
    const data = await this.post(`/api/v1/command/${db}`, { language, command: q2 });
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

// ../code-indexer/dist/src/indexer.js
import { readFile as readFile3 } from "node:fs/promises";
import { basename, join as join5, resolve } from "node:path";

// ../code-indexer/dist/src/walker.js
import { readdir, stat } from "node:fs/promises";
import { join as join2, relative } from "node:path";
var DEFAULT_EXCLUDES = /* @__PURE__ */ new Set([
  // Version control
  ".git",
  ".svn",
  ".hg",
  // Package managers
  "node_modules",
  "vendor",
  ".pnpm",
  ".yarn",
  // Build / dist outputs
  "dist",
  "build",
  "out",
  "target",
  "obj",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".docusaurus",
  // React Native / Expo native shells (mostly CocoaPods + Gradle, occasionally code)
  "ios",
  "android",
  ".expo",
  // Application logs
  "logs",
  // Caches
  "tmp",
  ".cache",
  ".turbo",
  ".parcel-cache",
  ".phpunit.cache",
  ".pytest_cache",
  "__pycache__",
  "coverage",
  ".nyc_output",
  // Editor / IDE
  ".idea",
  ".vscode",
  // User-archived code (common convention in monorepos)
  "archive",
  "archives"
]);
async function walkRepo(root, options = {}) {
  const excludes = options.excludes ?? new Set(DEFAULT_EXCLUDES);
  const out = [];
  await walk(root, root, excludes, out);
  out.sort();
  return out;
}
async function walk(root, dir, excludes, out) {
  const entries = await readdir(dir);
  for (const entry of entries) {
    if (excludes.has(entry))
      continue;
    const full = join2(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) {
      await walk(root, full, excludes, out);
    } else if (s.isFile()) {
      out.push(relative(root, full));
    }
  }
}

// ../code-indexer/dist/src/languages.js
var TS_EXT = /* @__PURE__ */ new Set([".ts", ".tsx"]);
var JS_EXT = /* @__PURE__ */ new Set([".js", ".jsx", ".mjs", ".cjs"]);
var PHP_EXT = /* @__PURE__ */ new Set([".php"]);
var JAVA_EXT = /* @__PURE__ */ new Set([".java"]);
function detectLanguage(path) {
  const ext = extOf(path);
  if (TS_EXT.has(ext))
    return "ts";
  if (JS_EXT.has(ext))
    return "js";
  if (PHP_EXT.has(ext))
    return "php";
  if (JAVA_EXT.has(ext))
    return "java";
  return "other";
}
function extOf(path) {
  const i = path.lastIndexOf(".");
  if (i === -1)
    return "";
  return path.slice(i).toLowerCase();
}

// ../code-indexer/dist/src/modules.js
function detectModule(filePath) {
  const parts = filePath.split("/").filter(Boolean);
  if (parts.length === 1)
    return "root";
  if (parts[0] === "app" && parts.length >= 3 && /^[A-Z]/.test(parts[1])) {
    return parts[1];
  }
  return parts[0];
}

// ../code-indexer/dist/src/parsers/ts-imports.js
var IMPORT_RE = /^\s*import\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gm;
var DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
var REQUIRE_RE = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
function parseTsImports(source) {
  const stripped = stripComments(source);
  const out = [];
  for (const re of [IMPORT_RE, DYNAMIC_IMPORT_RE, REQUIRE_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(stripped)) !== null) {
      if (!isInsideStringLiteral(stripped, m.index)) {
        out.push({ idx: m.index, spec: m[1] });
      }
    }
  }
  out.sort((a, b) => a.idx - b.idx);
  return out.map((x) => x.spec);
}
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n")
        i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/"))
        i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
function isInsideStringLiteral(src, pos) {
  let inStr = null;
  for (let i = 0; i < pos; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\" && i + 1 < pos) {
        i++;
        continue;
      }
      if (c === inStr)
        inStr = null;
    } else {
      if (c === '"' || c === "'" || c === "`")
        inStr = c;
    }
  }
  return inStr !== null;
}

// ../code-indexer/dist/src/parsers/php-imports.js
var SIMPLE_USE_RE = /^\s*use\s+([\w\\]+)(?:\s+as\s+\w+)?\s*;/gm;
var GROUPED_USE_RE = /^\s*use\s+([\w\\]+)\\\{\s*([^}]+)\}\s*;/gm;
function parsePhpImports(source) {
  const out = [];
  GROUPED_USE_RE.lastIndex = 0;
  let m;
  while ((m = GROUPED_USE_RE.exec(source)) !== null) {
    const base = m[1];
    const parts = m[2].split(",").map((s) => s.trim()).filter(Boolean);
    let offset = 0;
    for (const part of parts) {
      const fqn = `${base}\\${part.split(/\s+as\s+/i)[0].trim()}`;
      out.push({ idx: m.index + offset, fqn });
      offset++;
    }
  }
  SIMPLE_USE_RE.lastIndex = 0;
  while ((m = SIMPLE_USE_RE.exec(source)) !== null) {
    if (/\\\{/.test(m[0]))
      continue;
    out.push({ idx: m.index, fqn: m[1] });
  }
  out.sort((a, b) => a.idx - b.idx);
  return out.map((x) => x.fqn);
}

// ../code-indexer/dist/src/parsers/java-imports.js
var PACKAGE_RE = /^\s*package\s+([\w.]+)\s*;/m;
var IMPORT_RE2 = /^\s*import\s+(?:(static)\s+)?([\w.]+(?:\.\*)?)\s*;/gm;
function parseJavaPackage(source) {
  const m = PACKAGE_RE.exec(stripComments2(source));
  return m ? m[1] : null;
}
function parseJavaImports(source) {
  const stripped = stripComments2(source);
  const out = [];
  IMPORT_RE2.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE2.exec(stripped)) !== null) {
    const isStatic = Boolean(m[1]);
    const ref = m[2];
    if (isStatic) {
      out.push({ fqn: dropLastSegment(ref), kind: "static" });
    } else if (ref.endsWith(".*")) {
      out.push({ fqn: ref.slice(0, -2), kind: "wildcard" });
    } else {
      out.push({ fqn: ref, kind: "single" });
    }
  }
  return out;
}
function dropLastSegment(fqn) {
  const i = fqn.lastIndexOf(".");
  return i === -1 ? fqn : fqn.slice(0, i);
}
function stripComments2(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n")
        i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/"))
        i++;
      i += 2;
      continue;
    }
    if (c === '"' && next === '"' && src[i + 2] === '"') {
      out += '"""';
      i += 3;
      while (i < n && !(src[i] === '"' && src[i + 1] === '"' && src[i + 2] === '"')) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += '"""';
      i += 3;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      out += quote;
      i++;
      while (i < n && src[i] !== quote && src[i] !== "\n") {
        if (src[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        out += " ";
        i++;
      }
      if (i < n && src[i] === quote) {
        out += quote;
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// ../code-indexer/dist/src/resolvers/java.js
function javaFqnForFile(relPath, pkg) {
  const file = relPath.split(/[/\\]/).pop() ?? relPath;
  const base = file.replace(/\.java$/, "");
  return pkg ? `${pkg}.${base}` : base;
}
function resolveJavaImport(imp, typeIndex, packages) {
  if (imp.kind === "wildcard") {
    if (packages.has(imp.fqn))
      return { kind: "module", pkg: imp.fqn };
    return { kind: "unresolved", spec: `${imp.fqn}.*` };
  }
  let current = imp.fqn;
  while (current) {
    const path = typeIndex.get(current);
    if (path)
      return { kind: "file", path };
    const lastDot = current.lastIndexOf(".");
    if (lastDot === -1)
      break;
    current = current.slice(0, lastDot);
  }
  return { kind: "unresolved", spec: imp.fqn };
}

// ../code-indexer/dist/src/resolvers/path.js
import { posix } from "node:path";
function resolveRelative(fromFile, spec) {
  if (!spec.startsWith("."))
    return spec;
  const fromDir = posix.dirname(fromFile);
  const joined = posix.normalize(posix.join(fromDir, spec));
  return joined;
}
function resolvePsr4(fqn, map) {
  const sortedPrefixes = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const prefix of sortedPrefixes) {
    if (fqn.startsWith(prefix)) {
      const rest = fqn.slice(prefix.length).replace(/\\/g, "/");
      return `${map[prefix]}${rest}.php`;
    }
  }
  return null;
}

// ../code-indexer/dist/src/resolvers/tsconfig.js
import { readFile } from "node:fs/promises";
import { join as join3, posix as posix2 } from "node:path";
async function findTsconfigs(projectRoot, walkedFiles) {
  const out = /* @__PURE__ */ new Map();
  const tsconfigFiles = walkedFiles.filter((f) => f.endsWith("tsconfig.json"));
  for (const rel of tsconfigFiles) {
    try {
      const text = await readFile(join3(projectRoot, rel), "utf8");
      const cleaned = stripJsonComments(text);
      const parsed = JSON.parse(cleaned);
      const co = parsed?.compilerOptions ?? {};
      const paths = co.paths;
      if (!paths || typeof paths !== "object")
        continue;
      const baseUrl = typeof co.baseUrl === "string" ? co.baseUrl : ".";
      const configDir2 = posix2.dirname(rel);
      out.set(configDir2, { configDir: configDir2, baseUrl, paths });
    } catch {
    }
  }
  return out;
}
function tsconfigForFile(importingFile, configs) {
  let dir = posix2.dirname(importingFile);
  while (true) {
    const c = configs.get(dir);
    if (c)
      return c;
    const parent = posix2.dirname(dir);
    if (parent === dir)
      return null;
    dir = parent;
  }
}
function resolveAlias(spec, config) {
  for (const [pattern, targets] of Object.entries(config.paths)) {
    if (!targets || !targets.length)
      continue;
    const target = targets[0];
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -2);
      if (!spec.startsWith(prefix + "/") && spec !== prefix)
        continue;
      const rest = spec === prefix ? "" : spec.slice(prefix.length + 1);
      const targetBase = target.endsWith("/*") ? target.slice(0, -2) : target;
      const resolvedInConfig = posix2.normalize(posix2.join(targetBase, rest));
      return joinFromRoot(config, resolvedInConfig);
    }
    if (pattern === spec) {
      return joinFromRoot(config, target);
    }
  }
  return null;
}
function joinFromRoot(config, pathInsideConfig) {
  const cleaned = pathInsideConfig.replace(/^\.\//, "");
  const baseUrl = config.baseUrl.replace(/^\.\//, "");
  const inProject = posix2.normalize(posix2.join(config.configDir, baseUrl, cleaned));
  return inProject;
}
function stripJsonComments(text) {
  let out = "";
  let i = 0;
  let inString = false;
  let stringChar = "";
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\" && next) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === stringChar)
        inString = false;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n")
        i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/"))
        i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

// ../code-indexer/dist/src/resolvers/composer.js
import { readFile as readFile2 } from "node:fs/promises";
import { join as join4, posix as posix3 } from "node:path";
async function findComposers(projectRoot, walkedFiles) {
  const out = /* @__PURE__ */ new Map();
  const composerFiles = walkedFiles.filter((f) => f.endsWith("composer.json"));
  for (const rel of composerFiles) {
    try {
      const text = await readFile2(join4(projectRoot, rel), "utf8");
      const parsed = JSON.parse(text);
      const psr4Raw = {
        ...parsed?.autoload?.["psr-4"] ?? {},
        ...parsed?.["autoload-dev"]?.["psr-4"] ?? {}
      };
      const composerDir = posix3.dirname(rel);
      const psr4 = {};
      for (const [ns, target] of Object.entries(psr4Raw)) {
        const path = Array.isArray(target) ? target[0] : target;
        if (typeof path !== "string")
          continue;
        const cleaned = path.replace(/\/$/, "");
        const fromRoot = composerDir === "." ? cleaned : posix3.normalize(posix3.join(composerDir, cleaned));
        psr4[ns] = `${fromRoot}/`;
      }
      if (Object.keys(psr4).length > 0)
        out.set(composerDir, { composerDir, psr4 });
    } catch {
    }
  }
  return out;
}
function composerForFile(importingFile, composers) {
  let dir = posix3.dirname(importingFile);
  while (true) {
    const c = composers.get(dir);
    if (c)
      return c;
    const parent = posix3.dirname(dir);
    if (parent === dir)
      return null;
    dir = parent;
  }
}

// ../code-indexer/dist/src/writer.js
function q(s) {
  if (s === void 0 || s === null)
    return "null";
  if (typeof s === "number")
    return String(s);
  return `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
async function upsertRepo(client, db, repo) {
  const cy = `
    MERGE (r:Repo {name: ${q(repo.name)}})
    SET r.path = ${q(repo.path)},
        r.stack = ${q(repo.stack)},
        r.lastIndexedAt = datetime(${q((/* @__PURE__ */ new Date()).toISOString())})
  `;
  await client.execute(db, "cypher", cy);
}
async function upsertModule(client, db, mod) {
  const cy = `
    MERGE (m:Module {path: ${q(mod.path)}})
    SET m.name = ${q(mod.name)},
        m.language = ${q(mod.language)}
  `;
  await client.execute(db, "cypher", cy);
}
async function upsertFile(client, db, file) {
  const cy = `
    MERGE (f:File {path: ${q(file.path)}})
    SET f.language = ${q(file.language)},
        f.loc = ${q(file.loc)},
        f.hash = ${q(file.hash)},
        f.modifiedAt = datetime(${q((/* @__PURE__ */ new Date()).toISOString())})
  `;
  await client.execute(db, "cypher", cy);
}
async function linkContains(client, db, parentLabel, parentKey, childLabel, childKey) {
  const pk = Object.entries(parentKey).map(([k, v]) => `${k}: ${q(v)}`).join(", ");
  const ck = Object.entries(childKey).map(([k, v]) => `${k}: ${q(v)}`).join(", ");
  const cy = `
    MATCH (p:${parentLabel} {${pk}})
    MATCH (c:${childLabel} {${ck}})
    MERGE (p)-[:CONTAINS]->(c)
  `;
  await client.execute(db, "cypher", cy);
}
async function linkImports(client, db, fromPath, toPath, unresolvedSpec) {
  if (toPath) {
    const cy = `
      MATCH (a:File {path: ${q(fromPath)}})
      MATCH (b:File {path: ${q(toPath)}})
      MERGE (a)-[:IMPORTS]->(b)
    `;
    await client.execute(db, "cypher", cy);
    return;
  }
  if (unresolvedSpec) {
    const cy = `
      MATCH (f:File {path: ${q(fromPath)}})
      SET f.unresolvedImports = coalesce(f.unresolvedImports, '') + ${q(unresolvedSpec + ",")}
    `;
    await client.execute(db, "cypher", cy);
  }
}
async function linkImportsToModule(client, db, fromFilePath, modulePath) {
  const cy = `
    MATCH (a:File {path: ${q(fromFilePath)}})
    MATCH (m:Module {path: ${q(modulePath)}})
    MERGE (a)-[:IMPORTS]->(m)
  `;
  await client.execute(db, "cypher", cy);
}

// ../code-indexer/dist/src/indexer.js
async function indexRepo(client, rootAbsPath, options) {
  const root = resolve(rootAbsPath);
  const repoName = basename(root);
  if (options.autoMigrate) {
    await applySchemas(client, options.db, ["core", "code"]);
  }
  await upsertRepo(client, options.db, {
    name: repoName,
    path: root,
    stack: options.stack ?? "unknown"
  });
  const excludes = new Set(options.noDefaultExcludes ? [] : DEFAULT_EXCLUDES);
  for (const e of options.extraExcludes ?? [])
    excludes.add(e);
  const files = await walkRepo(root, { excludes });
  const tsconfigs = await findTsconfigs(root, files);
  const composers = await findComposers(root, files);
  const fileLanguages = /* @__PURE__ */ new Map();
  const moduleNames = /* @__PURE__ */ new Set();
  let indexedFileCount = 0;
  const javaTypeIndex = /* @__PURE__ */ new Map();
  const javaPackages = /* @__PURE__ */ new Set();
  for (const rel of files) {
    const lang = detectLanguage(rel);
    fileLanguages.set(rel, lang);
    if (lang === "other")
      continue;
    indexedFileCount++;
    const fullPath = join5(root, rel);
    const source = await readFile3(fullPath, "utf8");
    const loc = source.split("\n").length;
    const repoQualified = `${repoName}/${rel}`;
    await upsertFile(client, options.db, {
      path: repoQualified,
      language: lang,
      loc
    });
    let moduleName;
    if (lang === "java") {
      const pkg = parseJavaPackage(source);
      moduleName = pkg ?? detectModule(rel);
      const fqn = javaFqnForFile(rel, pkg);
      if (!javaTypeIndex.has(fqn))
        javaTypeIndex.set(fqn, rel);
      if (pkg)
        javaPackages.add(pkg);
    } else {
      moduleName = detectModule(rel);
    }
    const moduleQualified = `${repoName}/${moduleName}`;
    if (!moduleNames.has(moduleQualified)) {
      await upsertModule(client, options.db, {
        name: moduleName,
        path: moduleQualified,
        language: lang
      });
      await linkContains(client, options.db, "Repo", { name: repoName }, "Module", { path: moduleQualified });
      moduleNames.add(moduleQualified);
    }
    await linkContains(client, options.db, "Module", { path: moduleQualified }, "File", { path: repoQualified });
  }
  const knownFiles = new Set(fileLanguages.keys());
  let importsCount = 0;
  let unresolvedCount = 0;
  for (const rel of files) {
    const lang = fileLanguages.get(rel);
    if (lang === "other")
      continue;
    const fullPath = join5(root, rel);
    const source = await readFile3(fullPath, "utf8");
    const repoQualified = `${repoName}/${rel}`;
    if (lang === "java") {
      for (const imp of parseJavaImports(source)) {
        const res = resolveJavaImport(imp, javaTypeIndex, javaPackages);
        if (res.kind === "file") {
          await linkImports(client, options.db, repoQualified, `${repoName}/${res.path}`);
          importsCount++;
        } else if (res.kind === "module") {
          await linkImportsToModule(client, options.db, repoQualified, `${repoName}/${res.pkg}`);
          importsCount++;
        } else {
          await linkImports(client, options.db, repoQualified, null, res.spec);
          unresolvedCount++;
        }
      }
      continue;
    }
    const specs = lang === "php" ? parsePhpImports(source) : parseTsImports(source);
    for (const spec of specs) {
      const resolved = lang === "php" ? resolvePhpImport(spec, rel, composers, options.psr4, knownFiles) : resolveTsImport(spec, rel, tsconfigs, knownFiles);
      if (resolved && knownFiles.has(resolved)) {
        const targetQualified = `${repoName}/${resolved}`;
        await linkImports(client, options.db, repoQualified, targetQualified);
        importsCount++;
      } else {
        await linkImports(client, options.db, repoQualified, null, spec);
        unresolvedCount++;
      }
    }
  }
  return {
    repo: repoName,
    files: indexedFileCount,
    totalFiles: files.length,
    imports: importsCount,
    unresolved: unresolvedCount
  };
}
function resolveTsImport(spec, fromFile, tsconfigs, known) {
  if (!spec.startsWith(".")) {
    const tsconfig = tsconfigForFile(fromFile, tsconfigs);
    if (tsconfig) {
      const aliased = resolveAlias(spec, tsconfig);
      if (aliased) {
        const found = resolveWithExtensions(aliased, known);
        if (found)
          return found;
      }
    }
    return null;
  }
  const base = resolveRelative(fromFile, spec);
  return resolveWithExtensions(base, known);
}
function resolveWithExtensions(base, known) {
  const exts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
  if (known.has(base))
    return base;
  for (const ext of exts) {
    const candidate = `${base}${ext}`;
    if (known.has(candidate))
      return candidate;
  }
  for (const ext of exts) {
    const candidate = `${base}/index${ext}`;
    if (known.has(candidate))
      return candidate;
  }
  return null;
}
function resolvePhpImport(spec, fromFile, composers, override, known) {
  if (override) {
    const candidate2 = resolvePsr4(spec, override);
    if (candidate2 && known.has(candidate2))
      return candidate2;
  }
  const composer = composerForFile(fromFile, composers);
  if (!composer)
    return null;
  const candidate = resolvePsr4(spec, composer.psr4);
  if (candidate && known.has(candidate))
    return candidate;
  return null;
}

// src/env-paths.ts
import { homedir as homedir2 } from "node:os";
import { join as join6 } from "node:path";
function configDir() {
  return join6(homedir2(), ".config", "arcadedb");
}
function projectsJsonPath() {
  return join6(configDir(), "projects.json");
}
function captureLogPath() {
  return join6(configDir(), "capture.log");
}

// src/config.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { dirname, join as join7 } from "node:path";
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
  return join7(configDir(), ".env");
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

// src/auto-register.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync2, readFileSync as readFileSync3, renameSync as renameSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { basename as basename2, dirname as dirname2, join as join8 } from "node:path";

// src/project-map.ts
import { readFileSync as readFileSync2, existsSync as existsSync2, realpathSync } from "node:fs";
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

// src/auto-register.ts
function writeProjectsFile(projectsPath, map) {
  const dir = dirname2(projectsPath);
  if (!existsSync3(dir)) mkdirSync2(dir, { recursive: true });
  const tmp = `${projectsPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync2(tmp, JSON.stringify(map, null, 2) + "\n");
  renameSync2(tmp, projectsPath);
}
function updateProject(projectsPath, key, patch) {
  const map = loadProjects(projectsPath, (err) => {
    throw err;
  });
  const current = map.projects[key];
  if (!current) return null;
  const next = { ...current, ...patch };
  map.projects[key] = next;
  writeProjectsFile(projectsPath, map);
  return next;
}

// src/index-need.ts
import { join as join9 } from "node:path";
function stalePath() {
  return join9(configDir(), "stale.log");
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

// src/index-runner.ts
var DEFAULT_MAX_FILES = 2e4;
function maxFiles() {
  const raw = Number(process.env["ARCADEDB_INDEX_MAX_FILES"]);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_FILES;
}
function flag(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? void 0 : argv[i + 1];
}
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
    pid = Number(readFileSync4(path, "utf8").trim());
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
function countTrackedFiles(root) {
  try {
    const out = execSync("git ls-files", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
    return out.split("\n").filter(Boolean).length;
  } catch {
    return null;
  }
}
var STALE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1e3;
function pruneStale(path, key, now = Date.now()) {
  if (!existsSync5(path)) return;
  const mine = new RegExp(`^\\[[^\\]]+\\] ${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(`);
  const kept = readFileSync4(path, "utf8").split("\n").filter((l) => {
    if (!l) return false;
    if (mine.test(l)) return false;
    const m = /^\[([^\]]+)\]/.exec(l);
    if (!m) return true;
    const ts = new Date(m[1]).getTime();
    if (!Number.isFinite(ts)) return true;
    return now - ts <= STALE_MAX_AGE_MS;
  });
  writeFileSync3(path, kept.length ? kept.join("\n") + "\n" : "");
}
async function main() {
  const argv = process.argv.slice(2);
  const root = flag(argv, "root");
  const db = flag(argv, "db");
  const key = flag(argv, "key");
  const stack = flag(argv, "stack");
  if (!root || !db || !key) {
    console.error("usage: index-runner.js --root <abs> --db <db> --key <key> [--stack <csv>]");
    return 1;
  }
  const lock = join10(configDir(), `index-${key}.lock`);
  if (!acquireLock(lock)) {
    logCapture("index_skipped_running", { key });
    return 0;
  }
  const started = Date.now();
  try {
    const files = countTrackedFiles(root);
    if (files === null) {
      logCapture("index_skipped_not_git", { key, root });
      return 0;
    }
    if (files > maxFiles()) {
      logCapture("index_skipped_too_large", { key, files });
      return 0;
    }
    logCapture("index_started", { key, db, pid: process.pid, root });
    const client = new Client(toClientEnv(resolveConfig()));
    const summary = await indexRepo(client, root, { db, autoMigrate: true, stack: stack ?? void 0 });
    updateProject(projectsJsonPath(), key, { lastIndexed: (/* @__PURE__ */ new Date()).toISOString(), indexLevel: 2 });
    pruneStale(stalePath(), key);
    logCapture("index_done", { key, files: summary.files, imports: summary.imports, unresolved: summary.unresolved, ms: Date.now() - started });
    console.log(`indexed ${key}: ${summary.files} files, ${summary.imports} imports, ${summary.unresolved} unresolved`);
    return 0;
  } catch (err) {
    logCapture("index_failed", { key, error: err?.message ?? String(err) });
    console.error(`index failed: ${err?.message ?? String(err)}`);
    return 1;
  } finally {
    try {
      unlinkSync(lock);
    } catch {
    }
  }
}
function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return true;
  try {
    return realpathSync2(entry) === realpathSync2(fileURLToPath(import.meta.url));
  } catch {
    return true;
  }
}
if (isDirectRun()) {
  main().then((c) => process.exit(c)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
export {
  acquireLock,
  pruneStale
};
