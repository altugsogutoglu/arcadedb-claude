import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";

export interface ProjectEntry {
  db: string;
  path: string;
  stack: string[];
  indexLevel: number;
  lastIndexed: string | null;
}

export interface ProjectsMap {
  version: 1;
  defaultMemoryDb: string;
  projects: Record<string, ProjectEntry>;
}

const DEFAULT_MAP: ProjectsMap = {
  version: 1,
  defaultMemoryDb: "claude_memory",
  projects: {},
};

export function loadProjects(
  path: string,
  onError?: (err: Error) => void,
): ProjectsMap {
  if (!existsSync(path)) return { ...DEFAULT_MAP, projects: {} };
  const raw = readFileSync(path, "utf8");
  let parsed: ProjectsMap;
  try {
    parsed = JSON.parse(raw) as ProjectsMap;
  } catch (err) {
    onError?.(new Error(`projects.json at ${path} is malformed (${(err as Error).message}); falling back to empty project map.`));
    return { ...DEFAULT_MAP, projects: {} };
  }
  if (!parsed.defaultMemoryDb) parsed.defaultMemoryDb = "claude_memory";
  if (!parsed.projects) parsed.projects = {};
  return parsed;
}

export interface FindResult {
  key: string;
  entry: ProjectEntry;
}

export function findProject(
  map: ProjectsMap,
  cwd: string,
  gitRemoteUrl: string | null,
): FindResult | null {
  for (const [key, entry] of Object.entries(map.projects)) {
    if (entry.path === cwd) return { key, entry };
  }
  const base = basename(cwd);
  if (map.projects[base]) return { key: base, entry: map.projects[base]! };

  if (gitRemoteUrl) {
    const remoteName = extractRemoteName(gitRemoteUrl);
    if (remoteName && map.projects[remoteName]) {
      return { key: remoteName, entry: map.projects[remoteName]! };
    }
  }
  return null;
}

function extractRemoteName(url: string): string | null {
  const m = url.match(/[/:]([\w.-]+?)(?:\.git)?\s*$/);
  return m?.[1] ?? null;
}
