import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface ProjectEntry {
  db: string;
  path?: string;
  stack?: string | string[];
  indexLevel?: number;
  lastIndexed: string | null;
}

interface ProjectsConfig {
  version?: number;
  defaultMemoryDb?: string;
  projects?: Record<string, ProjectEntry>;
}

export function projectsJsonPath(): string {
  return join(homedir(), ".config", "arcadedb", "projects.json");
}

/**
 * Update `lastIndexed` in projects.json for the project matching either `db` or `rootPath`.
 * Silently no-ops if the file is missing, malformed, or no project matches —
 * the indexer must work even when no project map exists.
 *
 * Returns the matched project key, or null if nothing was updated.
 */
export function markProjectIndexed(
  db: string,
  rootPath: string,
  configPath: string = projectsJsonPath(),
  now: () => string = () => new Date().toISOString(),
): string | null {
  if (!existsSync(configPath)) return null;

  let parsed: ProjectsConfig;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8")) as ProjectsConfig;
  } catch {
    return null;
  }
  const projects = parsed.projects;
  if (!projects) return null;

  for (const [key, entry] of Object.entries(projects)) {
    if (entry.db === db || (entry.path && entry.path === rootPath)) {
      entry.lastIndexed = now();
      writeFileSync(configPath, JSON.stringify(parsed, null, 2) + "\n");
      return key;
    }
  }
  return null;
}
