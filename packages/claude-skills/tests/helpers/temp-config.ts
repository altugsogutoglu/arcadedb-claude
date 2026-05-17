import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TempConfig {
  path: string;
  cleanup(): void;
}

export function writeTempProjectsJson(content: object): TempConfig {
  const dir = mkdtempSync(join(tmpdir(), "arcadedb-skills-"));
  const path = join(dir, "projects.json");
  writeFileSync(path, JSON.stringify(content, null, 2));
  return {
    path,
    cleanup() { rmSync(dir, { recursive: true, force: true }); },
  };
}
