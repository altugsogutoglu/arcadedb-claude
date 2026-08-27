#!/usr/bin/env node
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { Client, EMBEDDED_TYPES } from "./agent-memory/index.js";
import { configDir } from "./env-paths.js";
import { resolveConfig, toClientEnv } from "./config.js";
import { acquireLock } from "./lock.js";
import { loadEmbedder, isEmbedInstalled, type Embedder } from "./embed.js";
import { logCapture } from "./capture-log.js";

const BATCH = 64;

/** Which text of a node gets embedded. */
export const TEXT_EXPR: Record<(typeof EMBEDDED_TYPES)[number], string> = {
  Turn: "text",
  Decision: "ifnull(summary, '') + ' ' + ifnull(rationale, '')",
  Insight: "ifnull(topic, '') + ' ' + ifnull(text, '')",
  Question: "ifnull(text, '')",
  Answer: "ifnull(text, '')",
};

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

/** Embed every node of the listed types whose `embedding` is still null. Returns how many were filled. */
export async function embedPending(client: Client, db: string, embed: Embedder, types: readonly string[] = EMBEDDED_TYPES): Promise<number> {
  let total = 0;
  for (const type of types) {
    const expr = TEXT_EXPR[type as keyof typeof TEXT_EXPR] ?? "text";
    for (;;) {
      const rows = await client.query<{ rid: string; body: string }>(db, "sql",
        `SELECT @rid AS rid, ${expr} AS body FROM ${type} WHERE embedding IS NULL LIMIT ${BATCH}`);
      if (rows.length === 0) break;
      const vectors = await embed(rows.map(r => r.body ?? ""));
      for (let i = 0; i < rows.length; i++) {
        const vec = vectors[i]!;
        await client.execute(db, "sql",
          `UPDATE ${rows[i]!.rid} SET embedding = [${vec.map(v => v.toFixed(6)).join(",")}]`);
      }
      total += rows.length;
      if (rows.length < BATCH) break;
    }
  }
  return total;
}

async function main(): Promise<void> {
  const db = flag(process.argv, "db");
  if (!db) {
    console.error("usage: embed-runner --db <name>");
    process.exit(2);
  }
  if (!isEmbedInstalled()) {
    logCapture("embed_skip", { reason: "not_installed", db });
    return;
  }
  const lock = join(configDir(), "embed.lock");
  if (!acquireLock(lock)) {
    logCapture("embed_skip", { reason: "locked", db });
    return;
  }
  const started = Date.now();
  try {
    const cfg = resolveConfig();
    const client = new Client(toClientEnv(cfg), { timeoutMs: 30_000 });
    const embed = await loadEmbedder();
    const n = await embedPending(client, db, embed);
    if (n > 0) logCapture("embed_done", { db, embedded: n, ms: Date.now() - started });
  } catch (err) {
    logCapture("embed_failed", { db, error: (err as Error)?.message ?? String(err) });
    process.exitCode = 1;
  } finally {
    try { unlinkSync(lock); } catch { /* already gone */ }
  }
}

const isEntry = process.argv[1] !== undefined && /embed-runner\.(?:js|ts)$/.test(process.argv[1]);
if (isEntry) {
  main().catch(err => {
    logCapture("embed_failed", { error: (err as Error)?.message ?? String(err) });
    process.exit(1);
  });
}
