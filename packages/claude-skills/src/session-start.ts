#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { execSync } from "node:child_process";
import { Client, loadEnv } from "arcadedb-agent-memory";
import { hookErrorLogPath, projectsJsonPath } from "./env-paths.js";
import { loadProjects, findProject } from "./project-map.js";
import { buildContext, type ProjectContext, type MemoryContext } from "./context-builder.js";

async function main(): Promise<void> {
  const cwd = process.env["PWD"] ?? process.cwd();
  const remote = safeGitRemote(cwd);
  const map = loadProjects(projectsJsonPath());
  const match = findProject(map, cwd, remote);

  const env = loadEnv();
  const client = new Client(env);

  let projectCtx: ProjectContext | null = null;
  if (match) {
    projectCtx = await probeProject(client, match.entry.db, match.key, match.entry.lastIndexed);
  }
  const memoryCtx = await probeMemory(client, map.defaultMemoryDb);

  process.stdout.write(buildContext({ project: projectCtx, memory: memoryCtx }) + "\n");
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
