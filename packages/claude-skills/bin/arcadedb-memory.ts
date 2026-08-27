#!/usr/bin/env node
import { Client } from "../src/agent-memory/client.js";
import { loadEnv } from "../src/agent-memory/env.js";
import { applySchemas } from "../src/agent-memory/migrations/apply.js";
import { allSchemas, type SchemaDomain } from "../src/agent-memory/schemas/all.js";
import { recordDecision } from "../src/agent-memory/memory/decisions.js";
import { recordInsight } from "../src/agent-memory/memory/insights.js";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const argv = process.argv.slice(2);
const [cmd, ...rest] = argv;

function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
}

async function main(): Promise<number> {
  if (cmd === "dryrun-review") {
    const session = rest[0];
    if (!session) { console.error("usage: arcadedb-memory dryrun-review <session>"); return 1; }

    const path = join(homedir(), ".config", "arcadedb", "dryrun", `${session}.jsonl`);
    if (!existsSync(path)) { console.error(`no dry-run file at ${path}`); return 1; }

    const acceptedPath = join(homedir(), ".config", "arcadedb", "dryrun-accepted.jsonl");
    if (!existsSync(dirname(acceptedPath))) mkdirSync(dirname(acceptedPath), { recursive: true });

    const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
    const triples = lines
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter((entry): entry is { kind: string } => entry !== null && entry.kind === "triple");

    if (triples.length === 0) {
      console.log("no triple lines found.");
      return 0;
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));

    let accepted = 0;
    let rejected = 0;
    let skipped = 0;

    for (let i = 0; i < triples.length; i++) {
      const entry = triples[i] as { kind: string; triple: { subject: { label: string; props: Record<string, unknown> }; verb: string; object: { label: string; props: Record<string, unknown> }; evidence?: string; confidence?: number } };
      const t = entry.triple;
      console.log(`\nTriple ${i + 1}/${triples.length}`);
      console.log(`  (${t.subject.label} ${JSON.stringify(t.subject.props)}) -[:${t.verb}]-> (${t.object.label} ${JSON.stringify(t.object.props)})`);
      if (t.evidence) console.log(`  evidence: ${t.evidence}`);
      if (t.confidence != null) console.log(`  confidence: ${t.confidence}`);

      const answer = (await ask("  [a]ccept  [r]eject  [s]kip  [q]uit: ")).trim().toLowerCase();
      if (answer === "a") {
        appendFileSync(acceptedPath, JSON.stringify({ session, ...entry }) + "\n");
        accepted++;
      } else if (answer === "r") {
        rejected++;
      } else if (answer === "q") {
        console.log("quit.");
        break;
      } else {
        skipped++;
      }
    }

    rl.close();
    console.log(`\nsummary: ${accepted} accepted, ${rejected} rejected, ${skipped} skipped (of ${triples.length} total)`);
    return 0;
  }

  const env = loadEnv();
  const client = new Client(env);

  switch (cmd) {
    case "migrate": {
      const db = rest[0];
      if (!db) { console.error("usage: arcadedb-memory migrate <db> [--only <domain>]"); return 1; }
      const only = flag("only");
      const domains = only ? [only as SchemaDomain] : (Object.keys(allSchemas) as SchemaDomain[]);
      await applySchemas(client, db, domains);
      console.log(`applied ${domains.length} domain${domains.length === 1 ? "" : "s"} to ${db}`);
      return 0;
    }
    case "record-decision": {
      const summary = rest[0];
      const rationale = flag("rationale") ?? "";
      const repo = flag("repo") ?? "";
      const db = flag("db") ?? "claude_memory";
      if (!summary || !repo) { console.error("usage: arcadedb-memory record-decision <summary> --rationale <text> --repo <name> [--session <id>] [--db claude_memory]"); return 1; }
      const sessionId = flag("session") ?? process.env["ARCADEDB_SESSION_ID"];
      const id = await recordDecision(client, db, { summary, rationale, repo, sessionId });
      console.log(id);
      return 0;
    }
    case "record-insight": {
      const topic = rest[0];
      const text = flag("text") ?? "";
      const repo = flag("repo");
      const db = flag("db") ?? "claude_memory";
      if (!topic || !text) { console.error("usage: arcadedb-memory record-insight <topic> --text <text> [--repo <name>] [--session <id>] [--db claude_memory]"); return 1; }
      const sessionId = flag("session") ?? process.env["ARCADEDB_SESSION_ID"];
      const id = await recordInsight(client, db, { topic, text, repo, sessionId });
      console.log(id);
      return 0;
    }
    case "status": {
      const dbs = await client.listDatabases();
      console.log("databases:", dbs.join(", "));
      for (const db of dbs) {
        try {
          const types = await client.query<{ name: string }>(db, "sql", "SELECT name FROM schema:types");
          console.log(`  ${db}: ${types.length} types`);
        } catch { /* type count is nice-to-have; skip on error */ }
      }
      return 0;
    }
    default:
      console.error("commands: migrate, record-decision, record-insight, status, dryrun-review");
      return 1;
  }
}

main().then(code => process.exit(code)).catch(err => { console.error(err); process.exit(1); });
