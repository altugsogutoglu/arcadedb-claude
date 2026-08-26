import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { execSync } from "node:child_process";
import { loadProjects, extractRemoteName, type ProjectEntry } from "./project-map.js";

export interface ProjectIdentity {
  key: string;
  db: string;
}

export function deriveProjectIdentity(cwd: string, gitRemoteUrl: string | null): ProjectIdentity {
  const key = (gitRemoteUrl ? extractRemoteName(gitRemoteUrl) : null) ?? basename(cwd);
  return { key, db: toDbName(key) };
}

function toDbName(key: string): string {
  const sanitized = key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[0-9]/.test(sanitized) ? `p_${sanitized}` : sanitized;
}

const NEXT_CONFIGS = ["next.config.js", "next.config.mjs", "next.config.ts"];
const EXPO_CONFIGS = ["app.json", "app.config.js", "app.config.ts"];

export function detectStack(cwd: string): string[] {
  const stack: string[] = [];
  const has = (name: string): boolean => existsSync(join(cwd, name));

  if (has("composer.json")) stack.push("laravel");

  const isNext = NEXT_CONFIGS.some(has);
  if (isNext) stack.push("nextjs");

  const isExpo = EXPO_CONFIGS.some(name => has(name) && fileMentionsExpo(join(cwd, name)));
  if (isExpo) stack.push("expo");

  const isTs = has("tsconfig.json");
  if (isTs) stack.push("typescript");
  if (has("package.json") && !isNext && !isExpo && !isTs) stack.push("javascript");
  if (has("pyproject.toml") || has("requirements.txt")) stack.push("python");

  return stack;
}

function fileMentionsExpo(path: string): boolean {
  try {
    return /["']?\bexpo\b["']?\s*:/.test(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
}

export function registerProject(projectsPath: string, key: string, entry: ProjectEntry): void {
  // Refuse to rewrite a file we could not parse: overwriting it would drop the user's entries.
  const map = loadProjects(projectsPath, err => { throw err; });
  if (map.projects[key]) return;
  map.projects[key] = entry;
  const dir = dirname(projectsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(projectsPath, JSON.stringify(map, null, 2) + "\n");
}

export function gitToplevel(cwd: string): string | null {
  try {
    const out = execSync("git rev-parse --show-toplevel", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() || null;
  } catch {
    return null;
  }
}
