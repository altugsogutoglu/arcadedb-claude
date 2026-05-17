#!/usr/bin/env node
import { resolve, basename } from "node:path";
import { Client, loadEnv } from "arcadedb-agent-memory";
import { syncVault } from "../src/syncer.js";

const argv = process.argv.slice(2);
const [vaultArg, ...rest] = argv;

function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
}

function bool(name: string): boolean {
  return rest.includes(`--${name}`);
}

async function main(): Promise<number> {
  if (!vaultArg) {
    console.error("usage: obsidian-sync <vault-dir> --db <name> [--vault-name <label>] [--auto-migrate]");
    return 1;
  }
  const db = flag("db");
  if (!db) {
    console.error("error: --db <name> is required");
    return 1;
  }

  const vaultRoot = resolve(vaultArg);
  const vaultName = flag("vault-name") ?? basename(vaultRoot);

  const client = new Client(loadEnv());
  const summary = await syncVault(client, vaultRoot, {
    db,
    vaultName,
    autoMigrate: bool("auto-migrate"),
  });

  console.log(
    `synced ${summary.vault}: ${summary.notes} notes, ${summary.tags} tags, ${summary.resolvedLinks} links, ${summary.unresolvedLinks} unresolved`
  );
  return 0;
}

main().then(code => process.exit(code)).catch(err => { console.error(err); process.exit(1); });
