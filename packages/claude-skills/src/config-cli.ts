import { spawnSync } from "node:child_process";
import { Client } from "./agent-memory/index.js";
import { resolveConfig, toClientEnv, writeEnvFile } from "./config.js";
import { probeServer, probeBanner } from "./server-probe.js";
import { loadProjects, findProject } from "./project-map.js";
import { resolveMemoryDb } from "./memory-db.js";
import { projectsJsonPath } from "./env-paths.js";
import { removeProject } from "./auto-register.js";
import { staleEditsSince, stalePath } from "./index-need.js";
import { runnerPath, runnerArgv } from "./index-spawn.js";
import { embedStatus } from "./embed.js";

type Io = { out: (s: string) => void; err?: (s: string) => void };

const SET_KEYS: Record<string, { env: string; validate: (v: string) => string | null }> = {
  server: { env: "ARCADEDB_HTTP_URI", validate: v => /^https?:\/\/[^\s/]+$/.test(v) ? null : "expected http://host:port" },
  user: { env: "ARCADEDB_USERNAME", validate: v => v.trim() ? null : "expected a user name" },
  password: { env: "ARCADEDB_ROOT_PASSWORD", validate: v => v ? null : "expected a non-empty password" },
  "memory-db": { env: "ARCADEDB_MEMORY_DB", validate: v => /^[a-z][a-z0-9_]*$/.test(v) ? null : "expected [a-z][a-z0-9_]*" },
  "auto-index": { env: "ARCADEDB_AUTO_INDEX", validate: v => v === "on" || v === "off" ? null : "expected on or off" },
  capture: { env: "ARCADEDB_CAPTURE", validate: v => v === "on" || v === "off" ? null : "expected on or off" },
  embed: { env: "ARCADEDB_EMBED", validate: v => v === "on" || v === "off" ? null : "expected on or off" },
  extractor: { env: "ARCADEDB_EXTRACTOR", validate: v => v === "off" || v === "live" || v === "dryrun" ? null : "expected off, live or dryrun" },
};
export const SET_KEY_NAMES = Object.keys(SET_KEYS).join("|");

function pad(s: string, n: number): string {
  return s.padEnd(n);
}

export async function configShow(io: Io): Promise<number> {
  const cfg = resolveConfig();
  const map = loadProjects(projectsJsonPath());
  const memoryDb = resolveMemoryDb(cfg, map);
  io.out(`ArcadeDB config (${cfg.envPath})`);
  io.out(`  ${pad("server:", 12)}${pad(cfg.httpUri, 24)}(${cfg.sources.httpUri})`);
  io.out(`  ${pad("user:", 12)}${pad(cfg.username, 24)}(${cfg.sources.username})`);
  io.out(`  ${pad("password:", 12)}${pad(cfg.password ? "********" : "(not set)", 24)}(${cfg.sources.password})`);
  io.out(`  ${pad("memory-db:", 12)}${pad(memoryDb, 24)}(${cfg.sources.memoryDb})`);
  io.out(`  ${pad("auto-index:", 12)}${pad(cfg.autoIndex ? "on" : "off", 24)}(${cfg.sources.autoIndex})`);
  io.out(`  ${pad("capture:", 12)}${pad(cfg.capture ? "on" : "off", 24)}(${cfg.sources.capture})`);
  io.out(`  ${pad("embed:", 12)}${pad(cfg.embed ? `on, runtime ${embedStatus()}` : "off", 24)}(${cfg.sources.embed})`);
  io.out(`  ${pad("extractor:", 12)}${pad(cfg.extractor, 24)}(${cfg.sources.extractor})`);
  const probe = await probeServer(toClientEnv(cfg));
  const bannerLines = probeBanner(probe, cfg.username);
  io.out(probe.status === "ok" ? bannerLines[0]!.replace(/^ {2}/, "") : bannerLines[0]!);
  const keys = Object.keys(map.projects);
  io.out(`Projects (${keys.length}):`);
  for (const key of keys) {
    const e = map.projects[key]!;
    io.out(`  ${key} -> ${e.db} (indexed: ${e.lastIndexed ?? "never"}, stale edits: ${staleEditsSince(stalePath(), key, e.lastIndexed)}, ${e.path})`);
  }
  return 0;
}

export function configSet(key: string, value: string, io: Io): number {
  const spec = SET_KEYS[key];
  if (!spec) {
    io.err?.(`unknown key: ${key} (${SET_KEY_NAMES})`);
    return 1;
  }
  if (/[\n\r]/.test(value)) {
    io.err?.(`invalid value for ${key}: must not contain line breaks`);
    return 1;
  }
  const problem = spec.validate(value);
  if (problem) {
    io.err?.(`invalid value for ${key}: ${problem}`);
    return 1;
  }
  writeEnvFile({ [spec.env]: value });
  io.out(`${key} updated in ${resolveConfig().envPath}`);
  return 0;
}

export async function configTest(io: Io): Promise<number> {
  const cfg = resolveConfig();
  const probe = await probeServer(toClientEnv(cfg));
  for (const line of probeBanner(probe, cfg.username)) io.out(line.replace(/^ {2}/, ""));
  return probe.status === "ok" ? 0 : 1;
}

export async function configForget(key: string, dropDb: boolean, io: Io): Promise<number> {
  const map = loadProjects(projectsJsonPath());
  const entry = map.projects[key];
  if (!entry) {
    io.err?.(`not registered: ${key}`);
    return 1;
  }
  if (dropDb) {
    if (!/^[a-z][a-z0-9_]*$/.test(entry.db)) {
      io.err?.(`refusing to drop database with unsafe name: ${entry.db}`);
      return 1;
    }
    const client = new Client(toClientEnv(resolveConfig()));
    await client.command(`drop database ${entry.db}`);
    io.out(`dropped database ${entry.db}`);
  }
  removeProject(projectsJsonPath(), key);
  io.out(`forgot ${key}`);
  return 0;
}

export async function configIndex(keyArg: string | null, cwd: string, io: Io): Promise<number> {
  const map = loadProjects(projectsJsonPath());
  const match = keyArg
    ? (map.projects[keyArg] ? { key: keyArg, entry: map.projects[keyArg]! } : null)
    : findProject(map, cwd, null);
  if (!match) {
    io.err?.("not registered: start a Claude Code session in the repo root once, then re-run");
    return 1;
  }
  const cmdArgs = ["--root", match.entry.path, "--db", match.entry.db, "--key", match.key];
  if (match.entry.stack.length) cmdArgs.push("--stack", match.entry.stack.join(","));
  const argv = runnerArgv(runnerPath(), cmdArgs);
  const r = spawnSync(process.execPath, argv, { stdio: "inherit", env: process.env });
  return r.status ?? 1;
}
