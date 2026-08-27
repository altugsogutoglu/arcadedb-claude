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
  /** Raw :Turn capture of every prompt/answer. No LLM involved. */
  capture: boolean;
  /** Local embeddings (transformers.js) for semantic search. No API involved. */
  embed: boolean;
  /** LLM extractor: off (default) | live | dryrun. Costs tokens per run. */
  extractor: "off" | "live" | "dryrun";
  envPath: string;
  sources: {
    httpUri: ConfigSource;
    username: ConfigSource;
    password: ConfigSource;
    memoryDb: ConfigSource;
    autoIndex: ConfigSource;
    capture: ConfigSource;
    embed: ConfigSource;
    extractor: ConfigSource;
  };
}

export const DEFAULTS = {
  httpUri: "http://localhost:2480",
  username: "root",
  memoryDb: "claude_memory",
  autoIndex: true,
  capture: true,
  embed: true,
  extractor: "off",
} as const;

const KEYS = {
  httpUri: "ARCADEDB_HTTP_URI",
  username: "ARCADEDB_USERNAME",
  password: "ARCADEDB_ROOT_PASSWORD",
  memoryDb: "ARCADEDB_MEMORY_DB",
  autoIndex: "ARCADEDB_AUTO_INDEX",
  capture: "ARCADEDB_CAPTURE",
  embed: "ARCADEDB_EMBED",
  extractor: "ARCADEDB_EXTRACTOR",
} as const;

export const DB_NAME = /^[a-z][a-z0-9_]*$/;

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
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
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
  // A database name that ArcadeDB cannot address is worse than the default: fall back rather than fail every write.
  if (!DB_NAME.test(memoryDb.value)) {
    memoryDb.value = DEFAULTS.memoryDb;
    memoryDb.source = "default";
  }
  const autoIndexRaw = pick(KEYS.autoIndex, processEnv, file, DEFAULTS.autoIndex ? "on" : "off");
  const captureRaw = pick(KEYS.capture, processEnv, file, DEFAULTS.capture ? "on" : "off");
  const embedRaw = pick(KEYS.embed, processEnv, file, DEFAULTS.embed ? "on" : "off");
  const extractorRaw = pick(KEYS.extractor, processEnv, file, DEFAULTS.extractor);
  const extractorMode = extractorRaw.value.toLowerCase();
  return {
    httpUri: httpUri.value.replace(/\/+$/, ""),
    username: username.value,
    password: password.value,
    memoryDb: memoryDb.value,
    autoIndex: autoIndexRaw.value.toLowerCase() !== "off",
    capture: captureRaw.value.toLowerCase() !== "off",
    embed: embedRaw.value.toLowerCase() !== "off",
    // "on" is accepted as an alias for live; anything unrecognised stays off so a typo cannot start spending tokens.
    extractor: extractorMode === "live" || extractorMode === "on" ? "live" : extractorMode === "dryrun" ? "dryrun" : "off",
    envPath,
    sources: {
      httpUri: httpUri.source,
      username: username.source,
      password: password.source,
      memoryDb: memoryDb.source,
      autoIndex: autoIndexRaw.source,
      capture: captureRaw.source,
      embed: embedRaw.source,
      extractor: extractorRaw.source,
    },
  };
}

export function toClientEnv(cfg: ResolvedConfig): { httpUri: string; username: string; password: string } {
  return { httpUri: cfg.httpUri, username: cfg.username, password: cfg.password };
}
