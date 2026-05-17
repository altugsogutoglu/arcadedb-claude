import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ArcadeDBEnv {
  password: string;
  httpUri: string;
  username: string;
}

const DEFAULT_PATH = join(homedir(), ".config", "arcadedb", ".env");

export function loadEnv(path: string = DEFAULT_PATH): ArcadeDBEnv {
  if (!existsSync(path)) {
    throw new Error(`Env file not found at ${path}. Create it with ARCADEDB_ROOT_PASSWORD=<your-password>.`);
  }
  const raw = readFileSync(path, "utf8");
  const map: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    map[key] = value;
  }
  const password = map["ARCADEDB_ROOT_PASSWORD"];
  if (!password) {
    throw new Error(`ARCADEDB_ROOT_PASSWORD missing in ${path}.`);
  }
  return {
    password,
    httpUri: map["ARCADEDB_HTTP_URI"] ?? "http://localhost:2480",
    username: map["ARCADEDB_USERNAME"] ?? "root",
  };
}
