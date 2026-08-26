import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { configDir } from "./env-paths.js";

export type ConfigSource = "default" | "file" | "env";

export interface ResolvedConfig {
  httpUri: string;
  username: string;
  password: string;
  memoryDb: string;
  autoIndex: boolean;
  envPath: string;
  sources: {
    httpUri: ConfigSource;
    username: ConfigSource;
    password: ConfigSource;
    memoryDb: ConfigSource;
    autoIndex: ConfigSource;
  };
}

export const DEFAULTS = {
  httpUri: "http://localhost:2480",
  username: "root",
  memoryDb: "claude_memory",
  autoIndex: true,
} as const;

const KEYS = {
  httpUri: "ARCADEDB_HTTP_URI",
  username: "ARCADEDB_USERNAME",
  password: "ARCADEDB_ROOT_PASSWORD",
  memoryDb: "ARCADEDB_MEMORY_DB",
  autoIndex: "ARCADEDB_AUTO_INDEX",
} as const;

export function envFilePath(): string {
  return join(configDir(), ".env");
}

export function readEnvFile(path: string = envFilePath()): Record<string, string> {
  if (!existsSync(path)) return {};
  const map: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    map[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return map;
}

export function writeEnvFile(values: Record<string, string>, path: string = envFilePath()): void {
  const merged = { ...readEnvFile(path), ...values };
  const body = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

export function ensureEnvFile(path: string = envFilePath()): boolean {
  if (existsSync(path)) return false;
  writeEnvFile({
    [KEYS.httpUri]: DEFAULTS.httpUri,
    [KEYS.username]: DEFAULTS.username,
    [KEYS.password]: "",
  }, path);
  return true;
}

function pick(
  key: string,
  processEnv: NodeJS.ProcessEnv,
  file: Record<string, string>,
  fallback: string,
): { value: string; source: ConfigSource } {
  const fromEnv = processEnv[key];
  if (fromEnv !== undefined && fromEnv !== "") return { value: fromEnv, source: "env" };
  const fromFile = file[key];
  if (fromFile !== undefined && fromFile !== "") return { value: fromFile, source: "file" };
  return { value: fallback, source: "default" };
}

export function resolveConfig(opts: { envPath?: string; processEnv?: NodeJS.ProcessEnv } = {}): ResolvedConfig {
  const envPath = opts.envPath ?? envFilePath();
  const processEnv = opts.processEnv ?? process.env;
  const file = readEnvFile(envPath);
  const httpUri = pick(KEYS.httpUri, processEnv, file, DEFAULTS.httpUri);
  const username = pick(KEYS.username, processEnv, file, DEFAULTS.username);
  const password = pick(KEYS.password, processEnv, file, "");
  const memoryDb = pick(KEYS.memoryDb, processEnv, file, DEFAULTS.memoryDb);
  const autoIndexRaw = pick(KEYS.autoIndex, processEnv, file, DEFAULTS.autoIndex ? "on" : "off");
  return {
    httpUri: httpUri.value.replace(/\/+$/, ""),
    username: username.value,
    password: password.value,
    memoryDb: memoryDb.value,
    autoIndex: autoIndexRaw.value.toLowerCase() !== "off",
    envPath,
    sources: {
      httpUri: httpUri.source,
      username: username.source,
      password: password.source,
      memoryDb: memoryDb.source,
      autoIndex: autoIndexRaw.source,
    },
  };
}

export function toClientEnv(cfg: ResolvedConfig): { httpUri: string; username: string; password: string } {
  return { httpUri: cfg.httpUri, username: cfg.username, password: cfg.password };
}
