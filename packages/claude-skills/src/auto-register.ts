import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { execSync } from "node:child_process";
import { loadProjects, extractRemoteName, type ProjectEntry, type ProjectsMap } from "./project-map.js";

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

export const MEMORY_DB_COLLISION = "db_collides_with_memory_db";

export class RegistrationError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "RegistrationError";
  }
}

export interface RegisterResult {
  /** The entry that now governs this key: the freshly written one, or the one already stored. */
  entry: ProjectEntry;
  created: boolean;
}

export function writeProjectsFile(projectsPath: string, map: ProjectsMap): void {
  const dir = dirname(projectsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // Unique per writer: concurrent hooks must not share one tmp path and clobber each other.
  const tmp = `${projectsPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(map, null, 2) + "\n");
  renameSync(tmp, projectsPath);
}

export function registerProject(projectsPath: string, key: string, entry: ProjectEntry): RegisterResult {
  // Refuse to rewrite a file we could not parse: overwriting it would drop the user's entries.
  const map = loadProjects(projectsPath, err => { throw err; });
  const existing = map.projects[key];
  if (existing) return { entry: existing, created: false };
  if (entry.db === map.defaultMemoryDb) throw new RegistrationError(MEMORY_DB_COLLISION);

  map.projects[key] = entry;
  writeProjectsFile(projectsPath, map);
  return { entry, created: true };
}

export function updateProject(projectsPath: string, key: string, patch: Partial<ProjectEntry>): ProjectEntry | null {
  const map = loadProjects(projectsPath, err => { throw err; });
  const current = map.projects[key];
  if (!current) return null;
  const next = { ...current, ...patch };
  map.projects[key] = next;
  writeProjectsFile(projectsPath, map);
  return next;
}

export function removeProject(projectsPath: string, key: string): boolean {
  const map = loadProjects(projectsPath, err => { throw err; });
  if (!map.projects[key]) return false;
  delete map.projects[key];
  writeProjectsFile(projectsPath, map);
  return true;
}

export function gitToplevel(cwd: string): string | null {
  try {
    const out = execSync("git rev-parse --show-toplevel", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() || null;
  } catch {
    return null;
  }
}
