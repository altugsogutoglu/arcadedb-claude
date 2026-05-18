#!/usr/bin/env node
import { Client } from "../src/client.js";
import { loadEnv } from "../src/env.js";
import { applySchemas } from "../src/migrations/apply.js";
import { allSchemas, type SchemaDomain } from "../src/schemas/all.js";
import { recordDecision } from "../src/memory/decisions.js";
import { recordInsight } from "../src/memory/insights.js";

const argv = process.argv.slice(2);
const [cmd, ...rest] = argv;

function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
}

async function main(): Promise<number> {
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
      console.error("commands: migrate, record-decision, record-insight, status");
      return 1;
  }
}

main().then(code => process.exit(code)).catch(err => { console.error(err); process.exit(1); });
