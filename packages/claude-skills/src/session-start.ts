#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  Client,
  loadEnv,
  startSession,
  findLatestSessionForRepo,
  linkFollows,
  applySchemas,
} from "arcadedb-agent-memory";
import { hookErrorLogPath, projectsJsonPath } from "./env-paths.js";
import { loadProjects, findProject, type FindResult, type ProjectEntry } from "./project-map.js";
import { deriveProjectIdentity, detectStack, registerProject, isGitRepo } from "./auto-register.js";
import {
  buildContext,
  type ProjectContext,
  type MemoryContext,
} from "./context-builder.js";
import { writeSessionState, readSessionState } from "./session-state.js";
import { readHookInput } from "./hook-input.js";
import { countTranscriptLines } from "./transcript-lines.js";
import { logCapture } from "./capture-log.js";

async function main(): Promise<void> {
  const input = readHookInput();
  const cwd = input.cwd ?? process.env["PWD"] ?? process.cwd();
  const remote = safeGitRemote(cwd);
  const map = loadProjects(projectsJsonPath(), logError);
  const match = findProject(map, cwd, remote);

  const env = loadEnv();
  const client = new Client(env);

  let project: FindResult | null = match;
  let autoRegistered = false;
  if (!match && isGitRepo(cwd)) {
    const identity = deriveProjectIdentity(cwd, remote);
    try {
      const entry: ProjectEntry = {
        db: identity.db,
        path: cwd,
        stack: detectStack(cwd),
        indexLevel: 0,
        lastIndexed: null,
      };
      registerProject(projectsJsonPath(), identity.key, entry);
      await applySchemas(client, identity.db, ["core", "code"]);
      logCapture("project_registered", { key: identity.key, db: identity.db, cwd });
      project = { key: identity.key, entry };
      autoRegistered = true;
    } catch (err) {
      logError(err);
      logCapture("project_register_failed", { key: identity.key, error: (err as Error)?.message ?? String(err) });
      project = null;
    }
  }

  let projectCtx: ProjectContext | null = null;
  if (project) {
    projectCtx = await probeProject(client, project.entry.db, project.key, project.entry.lastIndexed);
    if (autoRegistered) projectCtx.autoRegistered = true;
  }
  const memoryCtx = await probeMemory(client, map.defaultMemoryDb);

  process.stdout.write(buildContext({ project: projectCtx, memory: memoryCtx, extractorMode: process.env["ARCADEDB_EXTRACTOR"] }) + "\n");

  // After context is printed, set up :Session lifecycle if we have a project.
  if (project) {
    const claudeCodeSessionId = input.session_id ?? process.env["CLAUDE_SESSION_ID"] ?? `local-${randomUUID()}`;
    await tryStartSession(client, map.defaultMemoryDb, project.key, cwd, claudeCodeSessionId, input.transcript_path).catch(err => logError(err));
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
