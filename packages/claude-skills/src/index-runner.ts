#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { Client } from "arcadedb-agent-memory";
import { indexRepo } from "arcadedb-code-indexer";
import { configDir, projectsJsonPath } from "./env-paths.js";
import { resolveConfig, toClientEnv } from "./config.js";
import { updateProject } from "./auto-register.js";
import { stalePath } from "./index-need.js";
import { logCapture } from "./capture-log.js";

const MAX_FILES = 20000;

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function acquireLock(path: string): boolean {
  if (existsSync(path)) {
    const pid = Number(readFileSync(path, "utf8").trim());
    if (Number.isFinite(pid) && pid > 0 && pidAlive(pid)) return false;
  }
  writeFileSync(path, String(process.pid));
  return true;
}

function countTrackedFiles(root: string): number {
  try {
    const out = execSync("git ls-files", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
    return out.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

function pruneStale(path: string, key: string): void {
  if (!existsSync(path)) return;
  const kept = readFileSync(path, "utf8").split("\n").filter(l => l && !new RegExp(`^\\[[^\\]]+\\] ${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(`).test(l));
  writeFileSync(path, kept.length ? kept.join("\n") + "\n" : "");
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const root = flag(argv, "root");
  const db = flag(argv, "db");
  const key = flag(argv, "key");
  const stack = flag(argv, "stack");
  if (!root || !db || !key) {
    console.error("usage: index.js --root <abs> --db <db> --key <key> [--stack <csv>]");
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
    if (files > MAX_FILES) {
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

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
