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

export function sessionsDir(): string {
  return join(configDir(), "sessions");
}

export function sessionStatePath(claudeCodeSessionId: string): string {
  return join(sessionsDir(), `${claudeCodeSessionId}.json`);
}

export function dryrunPath(sessionDbId: string): string {
  return join(configDir(), "dryrun", `${sessionDbId}.jsonl`);
}

export function extractorErrorsPath(sessionDbId: string, timestamp: string): string {
  return join(configDir(), "extractor-errors", `${sessionDbId}-${timestamp}.txt`);
}
