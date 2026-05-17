#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Client, loadEnv, endSession } from "arcadedb-agent-memory";
import { hookErrorLogPath, projectsJsonPath } from "./env-paths.js";
import { loadProjects } from "./project-map.js";
import { readSessionState } from "./session-state.js";

async function main(): Promise<void> {
  const claudeCodeSessionId = process.env["CLAUDE_SESSION_ID"];
  if (!claudeCodeSessionId) return;

  const state = readSessionState(claudeCodeSessionId);
  if (!state) return;

  const map = loadProjects(projectsJsonPath());
  const env = loadEnv();
  const client = new Client(env);

  await endSession(client, map.defaultMemoryDb, state.sessionDbId);
}

function logError(err: unknown): void {
  try {
    const path = hookErrorLogPath();
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `[${new Date().toISOString()}] session-end: ${(err as Error)?.message ?? String(err)}\n`);
  } catch {
    // never let hook errors leak
  }
}

main().catch(err => {
  logError(err);
  process.exit(0);
});
