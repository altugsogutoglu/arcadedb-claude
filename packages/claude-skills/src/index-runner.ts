#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, unlinkSync, realpathSync } from "node:fs";
import { acquireLock } from "./lock.js";
export { acquireLock } from "./lock.js";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "./agent-memory/index.js";
import { indexRepo } from "./code-indexer/index.js";
import { configDir, projectsJsonPath } from "./env-paths.js";
import { resolveConfig, toClientEnv } from "./config.js";
import { updateProject } from "./auto-register.js";
import { stalePath } from "./index-need.js";
import { logCapture } from "./capture-log.js";

const DEFAULT_MAX_FILES = 20000;

function maxFiles(): number {
  const raw = Number(process.env["ARCADEDB_INDEX_MAX_FILES"]);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_FILES;
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

/** null when `git ls-files` fails: the size guard must fail closed rather than assume 0. */
function countTrackedFiles(root: string): number | null {
  try {
    const out = execSync("git ls-files", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
    return out.split("\n").filter(Boolean).length;
  } catch {
    return null;
  }
}

const STALE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Drops every line for `key` (just indexed, so nothing is stale any more) and, regardless of key,
 * any line older than 30 days: those belong to projects that are gone or were indexed elsewhere.
 */
export function pruneStale(path: string, key: string, now: number = Date.now()): void {
  if (!existsSync(path)) return;
  const mine = new RegExp(`^\\[[^\\]]+\\] ${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(`);
  const kept = readFileSync(path, "utf8").split("\n").filter(l => {
    if (!l) return false;
    if (mine.test(l)) return false;
    const m = /^\[([^\]]+)\]/.exec(l);
    if (!m) return true;
    const ts = new Date(m[1]!).getTime();
    if (!Number.isFinite(ts)) return true;
    return now - ts <= STALE_MAX_AGE_MS;
  });
  writeFileSync(path, kept.length ? kept.join("\n") + "\n" : "");
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const root = flag(argv, "root");
  const db = flag(argv, "db");
  const key = flag(argv, "key");
  const stack = flag(argv, "stack");
  if (!root || !db || !key) {
    console.error("usage: index-runner.js --root <abs> --db <db> --key <key> [--stack <csv>]");
    return 1;
  }
  const lock = join(configDir(), `index-${key}.lock`);
  if (!acquireLock(lock)) {
    logCapture("index_skipped_running", { key });
    return 0;
  }
  const started = Date.now();
  try {
    const files = countTrackedFiles(root);
    if (files === null) {
      logCapture("index_skipped_not_git", { key, root });
      return 0;
    }
    if (files > maxFiles()) {
      logCapture("index_skipped_too_large", { key, files });
      return 0;
    }
    logCapture("index_started", { key, db, pid: process.pid, root });
    const client = new Client(toClientEnv(resolveConfig()));
    const summary = await indexRepo(client, root, { db, autoMigrate: true, stack: stack ?? undefined });
    updateProject(projectsJsonPath(), key, { lastIndexed: new Date().toISOString(), indexLevel: 2 });
    pruneStale(stalePath(), key);
    logCapture("index_done", { key, files: summary.files, imports: summary.imports, unresolved: summary.unresolved, ms: Date.now() - started });
    console.log(`indexed ${key}: ${summary.files} files, ${summary.imports} imports, ${summary.unresolved} unresolved`);
    return 0;
  } catch (err) {
    logCapture("index_failed", { key, error: (err as Error)?.message ?? String(err) });
    console.error(`index failed: ${(err as Error)?.message ?? String(err)}`);
    return 1;
  } finally {
    try { unlinkSync(lock); } catch { /* already gone */ }
  }
}

/** True unless this module was imported (by a test); a misfire must favour running. */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return true;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return true;
  }
}

if (isDirectRun()) {
  main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
}
