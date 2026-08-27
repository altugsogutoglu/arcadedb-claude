#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  Client,
  startSession,
  findLatestSessionForRepo,
  linkFollows,
  applySchemas,
} from "arcadedb-agent-memory";
import { ensureEnvFile, resolveConfig, toClientEnv } from "./config.js";
import { resolveMemoryDb } from "./memory-db.js";
import { probeServer, probeBanner } from "./server-probe.js";
import { hookErrorLogPath, projectsJsonPath } from "./env-paths.js";
import { loadProjects, findProject, type FindResult, type ProjectEntry } from "./project-map.js";
import {
  deriveProjectIdentity,
  type ProjectIdentity,
  detectStack,
  registerProject,
  gitToplevel,
  RegistrationError,
  MEMORY_DB_COLLISION,
} from "./auto-register.js";
import {
  buildContext,
  type ProjectContext,
  type MemoryContext,
} from "./context-builder.js";
import { writeSessionState, readSessionState } from "./session-state.js";
import { readHookInput } from "./hook-input.js";
import { countTranscriptLines } from "./transcript-lines.js";
import { decideIndexNeed, stalePath } from "./index-need.js";
import { spawnIndexer } from "./index-spawn.js";
import { logCapture } from "./capture-log.js";

async function main(): Promise<void> {
  const input = readHookInput();
  const cwd = input.cwd ?? process.env["PWD"] ?? process.cwd();

  ensureEnvFile();
  const map = loadProjects(projectsJsonPath(), logError);
  const cfg = resolveConfig();
  const memoryDb = resolveMemoryDb(cfg, map);

  const probe = await probeServer(toClientEnv(cfg));
  if (probe.status !== "ok") {
    logCapture("server_unavailable", { status: probe.status, httpUri: probe.httpUri, detail: probe.detail });
    process.stdout.write(probeBanner(probe, cfg.username).join("\n") + "\n");
    return;
  }
  const serverLine = probeBanner(probe, cfg.username)[0]!;

  const client = new Client(toClientEnv(cfg));
  try {
    await applySchemas(client, memoryDb, ["core", "memory"]);
  } catch (err) {
    logError(err);
    logCapture("memory_schema_failed", { db: memoryDb, error: (err as Error)?.message ?? String(err) });
  }

  const remote = safeGitRemote(cwd);
  const match = findProject(map, cwd, remote);

  let project: FindResult | null = match;
  let autoRegistered = false;
  const toplevel = match ? null : gitToplevel(cwd);
  if (toplevel) {
    let identity: ProjectIdentity | null = null;
    try {
      // Register the repo root, not the subdirectory this session happens to start in.
      identity = deriveProjectIdentity(toplevel, remote);
      const stored = map.projects[identity.key];
      if (stored) {
        // The key is already registered under a path findProject could not match from here.
        // The stored entry owns its DB: use it as-is, do not touch schemas or the registry.
        project = { key: identity.key, entry: stored };
      } else {
        if (identity.db === memoryDb) throw new RegistrationError(MEMORY_DB_COLLISION);
        const entry: ProjectEntry = {
          db: identity.db,
          path: toplevel,
          stack: detectStack(toplevel),
          indexLevel: 0,
          lastIndexed: null,
        };
        // Schemas first: a failure here must leave projects.json untouched.
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
        key: identity?.key,
        reason: err instanceof RegistrationError ? err.reason : undefined,
        error: (err as Error)?.message ?? String(err),
      });
      project = null;
    }
  }

  let indexing = false;
  if (project && project.entry.path) {
    const need = decideIndexNeed(project.entry, project.key, stalePath(), cfg.autoIndex);
    if (need.needed) {
      const pid = spawnIndexer({ root: project.entry.path, db: project.entry.db, key: project.key, stack: project.entry.stack });
      indexing = pid !== null;
      logCapture("index_spawned", { key: project.key, reason: need.reason, staleEdits: need.staleEdits, pid });
    }
  }

  let projectCtx: ProjectContext | null = null;
  if (project) {
    projectCtx = await probeProject(client, project.entry.db, project.key, project.entry.lastIndexed);
    if (autoRegistered) projectCtx.autoRegistered = true;
    if (indexing) projectCtx.indexing = true;
  }
  const memoryCtx = await probeMemory(client, memoryDb);

  process.stdout.write(buildContext({ project: projectCtx, memory: memoryCtx, extractorMode: process.env["ARCADEDB_EXTRACTOR"], serverLine }) + "\n");

  // After context is printed, set up :Session lifecycle if we have a project.
  if (project) {
    const claudeCodeSessionId = input.session_id ?? process.env["CLAUDE_SESSION_ID"] ?? `local-${randomUUID()}`;
    await tryStartSession(client, memoryDb, project.key, cwd, claudeCodeSessionId, input.transcript_path).catch(err => logError(err));
  }
}

async function tryStartSession(
  client: Client,
  memoryDb: string,
  repo: string,
  cwd: string,
  claudeCodeSessionId: string,
  transcriptPath: string | undefined,
): Promise<void> {
  // Same Claude session resumed: state already exists, do not reset it or create a second :Session.
  if (readSessionState(claudeCodeSessionId)) {
    logCapture("session_resumed", { session: claudeCodeSessionId });
    return;
  }

  const userName = resolveUserName(cwd);

  // Find prior session for this repo BEFORE creating the new one (so excludeId isn't needed).
  const previousSessionId = await findLatestSessionForRepo(client, memoryDb, repo);

  const newSessionId = await startSession(client, memoryDb, { repo });

  const now = new Date().toISOString();
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
    lastExtractedLine: seedLine,
  });

  if (previousSessionId) {
    await linkFollows(client, memoryDb, newSessionId, previousSessionId);
  }
}

function resolveUserName(cwd: string): string {
  try {
    const out = execSync("git config user.name", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const trimmed = out.trim();
    if (trimmed) return trimmed;
  } catch {
    // fall through
  }
  return process.env["ARCADEDB_USER_NAME"] ?? process.env["USER"] ?? "unknown";
}

async function probeProject(
  client: Client,
  db: string,
  name: string,
  lastIndexed: string | null,
): Promise<ProjectContext> {
  const fileRows = await client.query<{ count: number }>(db, "cypher", "MATCH (f:File) RETURN count(f) AS count").catch(() => [{ count: 0 }]);
  const importRows = await client.query<{ count: number }>(db, "cypher", "MATCH ()-[r:IMPORTS]->() RETURN count(r) AS count").catch(() => [{ count: 0 }]);
  const typeRows = await client.query<{ name: string }>(db, "sql", "SELECT name FROM schema:types").catch(() => []);
  return {
    name,
    db,
    lastIndexed,
    fileCount: fileRows[0]?.count ?? 0,
    importCount: importRows[0]?.count ?? 0,
    types: typeRows.map(r => r.name),
  };
}

async function probeMemory(client: Client, db: string): Promise<MemoryContext> {
  const decisionRows = await client.query<{ count: number }>(db, "cypher", "MATCH (d:Decision) RETURN count(d) AS count").catch(() => [{ count: 0 }]);
  const insightRows = await client.query<{ count: number }>(db, "cypher", "MATCH (i:Insight) RETURN count(i) AS count").catch(() => [{ count: 0 }]);
  return {
    db,
    decisionCount: decisionRows[0]?.count ?? 0,
    insightCount: insightRows[0]?.count ?? 0,
  };
}

function safeGitRemote(cwd: string): string | null {
  try {
    const out = execSync("git remote get-url origin", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() || null;
  } catch {
    return null;
  }
}

function logError(err: unknown): void {
  try {
    const path = hookErrorLogPath();
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `[${new Date().toISOString()}] session-start: ${(err as Error)?.message ?? String(err)}\n`);
  } catch {
    // never let hook errors leak
  }
}

main().catch(err => {
  logError(err);
  process.exit(0);
});
