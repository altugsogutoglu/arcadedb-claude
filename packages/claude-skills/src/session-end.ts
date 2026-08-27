#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Client, endSession } from "./agent-memory/index.js";
import { hookErrorLogPath, projectsJsonPath } from "./env-paths.js";
import { loadProjects } from "./project-map.js";
import { resolveConfig, toClientEnv } from "./config.js";
import { resolveMemoryDb } from "./memory-db.js";
import { readSessionState } from "./session-state.js";
import { readHookInput } from "./hook-input.js";

async function main(): Promise<void> {
  const input = readHookInput();
  const claudeCodeSessionId = input.session_id ?? process.env["CLAUDE_SESSION_ID"];
  if (!claudeCodeSessionId) return;

  const state = readSessionState(claudeCodeSessionId);
  if (!state) return;

  const map = loadProjects(projectsJsonPath(), logError);
  const cfg = resolveConfig();
  const client = new Client(toClientEnv(cfg));

  await endSession(client, resolveMemoryDb(cfg, map), state.sessionDbId);
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
