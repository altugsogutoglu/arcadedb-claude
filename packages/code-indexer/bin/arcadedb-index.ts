#!/usr/bin/env node
import { resolve } from "node:path";
import { Client, loadEnv } from "arcadedb-agent-memory";
import { indexRepo } from "../src/indexer.js";

const argv = process.argv.slice(2);
const [target, ...rest] = argv;

function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
}

function bool(name: string): boolean {
  return rest.includes(`--${name}`);
}

async function main(): Promise<number> {
  if (!target) {
    console.error("usage: arcadedb-index <dir> --db <name> [--auto-migrate] [--stack nextjs|laravel|...]");
    return 1;
  }
  const db = flag("db");
  if (!db) {
    console.error("error: --db <name> is required");
    return 1;
  }

  const client = new Client(loadEnv());
  const summary = await indexRepo(client, resolve(target), {
    db,
    autoMigrate: bool("auto-migrate"),
    stack: flag("stack"),
  });

  console.log(`indexed ${summary.repo}: ${summary.files} files, ${summary.imports} imports, ${summary.unresolved} unresolved`);
  return 0;
}

main().then(code => process.exit(code)).catch(err => { console.error(err); process.exit(1); });
