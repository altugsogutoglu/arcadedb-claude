#!/usr/bin/env node

// src/post-tool-use.ts
import { appendFileSync, existsSync as existsSync2, mkdirSync } from "node:fs";
import { dirname, join as join2 } from "node:path";

// src/env-paths.ts
import { homedir } from "node:os";
import { join } from "node:path";
function configDir() {
  return join(homedir(), ".config", "arcadedb");
}
function projectsJsonPath() {
  return join(configDir(), "projects.json");
}
function hookErrorLogPath() {
  return join(configDir(), "hook-errors.log");
}

// src/project-map.ts
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
var DEFAULT_MAP = {
  version: 1,
  defaultMemoryDb: "claude_memory",
  projects: {}
};
function loadProjects(path, onError) {
  if (!existsSync(path)) return { ...DEFAULT_MAP, projects: {} };
  const raw = readFileSync(path, "utf8");
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

// src/post-tool-use.ts
async function main() {
  const cwd = process.env["PWD"] ?? process.cwd();
  const map = loadProjects(projectsJsonPath(), logError);
  const match = findProject(map, cwd, null);
  if (!match) return;
  const stalePath = join2(configDir(), "stale.log");
  if (!existsSync2(dirname(stalePath))) mkdirSync(dirname(stalePath), { recursive: true });
  appendFileSync(stalePath, `[${(/* @__PURE__ */ new Date()).toISOString()}] ${match.key} (cwd=${cwd})
`);
}
function logError(err) {
  try {
    const path = hookErrorLogPath();
    if (!existsSync2(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `[${(/* @__PURE__ */ new Date()).toISOString()}] post-tool-use: ${err?.message ?? String(err)}
`);
  } catch {
  }
}
main().catch((err) => {
  logError(err);
  process.exit(0);
});
