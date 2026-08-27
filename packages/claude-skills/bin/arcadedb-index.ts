#!/usr/bin/env node
import { resolve } from "node:path";
import { Client, loadEnv } from "../src/agent-memory/index.js";
import { indexRepo } from "../src/code-indexer/indexer.js";
import { markProjectIndexed } from "../src/code-indexer/projects-config.js";

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
    console.error(
      "usage: arcadedb-index <dir> --db <name>\n" +
      "                       [--auto-migrate]\n" +
      "                       [--stack nextjs|laravel|...]\n" +
      "                       [--exclude name1,name2,...]\n" +
      "                       [--no-default-excludes]",
    );
    return 1;
  }
  const db = flag("db");
  if (!db) {
    console.error("error: --db <name> is required");
    return 1;
  }

  const excludeArg = flag("exclude");
  const extraExcludes = excludeArg ? excludeArg.split(",").map(s => s.trim()).filter(Boolean) : undefined;

  const rootPath = resolve(target);
  const client = new Client(loadEnv());
  const summary = await indexRepo(client, rootPath, {
    db,
    autoMigrate: bool("auto-migrate"),
    stack: flag("stack"),
    extraExcludes,
    noDefaultExcludes: bool("no-default-excludes"),
  });

  const matched = markProjectIndexed(db, rootPath);
  const skipped = summary.totalFiles - summary.files;
  const skippedNote = skipped > 0 ? ` (${skipped} non-source skipped)` : "";
  console.log(`indexed ${summary.repo}: ${summary.files} files${skippedNote}, ${summary.imports} imports, ${summary.unresolved} unresolved`);
  if (matched) {
    console.log(`updated projects.json: ${matched}.lastIndexed`);
  }
  return 0;
}

main().then(code => process.exit(code)).catch(err => { console.error(err); process.exit(1); });
