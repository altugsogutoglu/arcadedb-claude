#!/usr/bin/env node

// src/session-start.ts
import { appendFileSync, existsSync as existsSync4, mkdirSync as mkdirSync2 } from "node:fs";
import { dirname as dirname2 } from "node:path";
import { execSync } from "node:child_process";
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

// src/project-map.ts
import { readFileSync as readFileSync2, existsSync as existsSync2 } from "node:fs";
import { basename } from "node:path";
var DEFAULT_MAP = {
  version: 1,
  defaultMemoryDb: "claude_memory",
  projects: {}
};
function loadProjects(path) {
  if (!existsSync2(path)) return { ...DEFAULT_MAP };
  const raw = readFileSync2(path, "utf8");
  const parsed = JSON.parse(raw);
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

// src/context-builder.ts
function buildContext(input) {
  const lines = ["ArcadeDB context loaded:"];
  if (input.project) {
    const p = input.project;
    const indexed = p.lastIndexed ?? "not indexed yet";
    lines.push(
      `  Project: ${p.name} (DB: ${p.db}, indexed: ${indexed}, ${p.fileCount} files, ${p.importCount} imports)`
    );
    if (p.types.length > 0) {
      lines.push(`  Schema: ${p.types.join(", ")}`);
    }
  }
  lines.push(
    `  Memory DB: ${input.memory.db} (${input.memory.decisionCount} decisions, ${input.memory.insightCount} insights)`
  );
  return lines.join("\n");
}

// src/session-state.ts
import { existsSync as existsSync3, mkdirSync, readFileSync as readFileSync3, writeFileSync } from "node:fs";
import { dirname } from "node:path";
function writeSessionState(state) {
  const path = sessionStatePath(state.claudeCodeSessionId);
  const dir = dirname(path);
  if (!existsSync3(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
}

// src/session-start.ts
async function main() {
  const cwd = process.env["PWD"] ?? process.cwd();
  const remote = safeGitRemote(cwd);
  const map = loadProjects(projectsJsonPath());
  const match = findProject(map, cwd, remote);
  const env = loadEnv();
  const client = new Client(env);
  let projectCtx = null;
  if (match) {
    projectCtx = await probeProject(client, match.entry.db, match.key, match.entry.lastIndexed);
  }
  const memoryCtx = await probeMemory(client, map.defaultMemoryDb);
  process.stdout.write(buildContext({ project: projectCtx, memory: memoryCtx }) + "\n");
  if (match) {
    await tryStartSession(client, map.defaultMemoryDb, match.key, cwd).catch((err) => logError(err));
  }
}
async function tryStartSession(client, memoryDb, repo, cwd) {
  const claudeCodeSessionId = process.env["CLAUDE_SESSION_ID"] ?? `local-${randomUUID2()}`;
  const userName = resolveUserName(cwd);
  const previousSessionId = await findLatestSessionForRepo(client, memoryDb, repo);
  const newSessionId = await startSession(client, memoryDb, { repo });
  const now = (/* @__PURE__ */ new Date()).toISOString();
  writeSessionState({
    claudeCodeSessionId,
    sessionDbId: newSessionId,
    repo,
    cwd,
    userName,
    startedAt: now,
    currentTurnIdx: 0,
    lastExtractedTurnIdx: 0,
    lastExtractedAt: now
  });
  if (previousSessionId) {
    await linkFollows(client, memoryDb, newSessionId, previousSessionId);
  }
}
function resolveUserName(cwd) {
  try {
    const out = execSync("git config user.name", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
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
    const out = execSync("git remote get-url origin", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() || null;
  } catch {
    return null;
  }
}
function logError(err) {
  try {
    const path = hookErrorLogPath();
    if (!existsSync4(dirname2(path))) mkdirSync2(dirname2(path), { recursive: true });
    appendFileSync(path, `[${(/* @__PURE__ */ new Date()).toISOString()}] session-start: ${err?.message ?? String(err)}
`);
  } catch {
  }
}
main().catch((err) => {
  logError(err);
  process.exit(0);
});
