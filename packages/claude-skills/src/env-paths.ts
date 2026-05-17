import { homedir } from "node:os";
import { join } from "node:path";

export function configDir(): string {
  return join(homedir(), ".config", "arcadedb");
}

export function projectsJsonPath(): string {
  return join(configDir(), "projects.json");
}

export function hookErrorLogPath(): string {
  return join(configDir(), "hook-errors.log");
}
