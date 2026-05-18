#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { configDir, projectsJsonPath, hookErrorLogPath } from "./env-paths.js";
import { loadProjects, findProject } from "./project-map.js";

async function main(): Promise<void> {
  const cwd = process.env["PWD"] ?? process.cwd();
  const map = loadProjects(projectsJsonPath(), logError);
  const match = findProject(map, cwd, null);
  if (!match) return;

  const stalePath = join(configDir(), "stale.log");
  if (!existsSync(dirname(stalePath))) mkdirSync(dirname(stalePath), { recursive: true });
  appendFileSync(stalePath, `[${new Date().toISOString()}] ${match.key} (cwd=${cwd})\n`);
}

function logError(err: unknown): void {
  try {
    const path = hookErrorLogPath();
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `[${new Date().toISOString()}] post-tool-use: ${(err as Error)?.message ?? String(err)}\n`);
  } catch { /* give up */ }
}

main().catch(err => {
  logError(err);
  process.exit(0);
});
