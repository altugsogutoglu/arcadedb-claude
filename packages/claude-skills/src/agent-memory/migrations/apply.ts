import type { Client } from "../client.js";
import { allSchemas, type SchemaDomain } from "../schemas/all.js";
import { renderSchema } from "./render.js";
import { backfillFullText } from "./fulltext.js";

export async function applySchemas(
  client: Client,
  database: string,
  domains?: SchemaDomain[],
): Promise<void> {
  await ensureDatabase(client, database);
  const selected = domains ?? (Object.keys(allSchemas) as SchemaDomain[]);
  for (const domain of selected) {
    const schema = allSchemas[domain];
    if (!schema) throw new Error(`Unknown schema domain: ${domain}`);
    const stmts = renderSchema(schema);
    for (const stmt of stmts) {
      const result = await client.execute<{ created?: boolean; totalIndexed?: number; name?: string }>(database, "sql", stmt);
      const created = Array.isArray(result) ? result[0] : undefined;
      // ArcadeDB builds a FULL_TEXT index over existing rows as a no-op (and REBUILD INDEX crashes on it):
      // only rows written after creation are searchable. Rewrite the old rows once so they get indexed.
      if (stmt.endsWith("FULL_TEXT") && created?.created && (created.totalIndexed ?? 0) > 0) {
        const m = /ON (\w+)\((\w+)\) FULL_TEXT$/.exec(stmt);
        if (m) await backfillFullText(client, database, m[1]!, m[2]!);
      }
    }
  }
}

async function ensureDatabase(client: Client, database: string): Promise<void> {
  const existing = await client.listDatabases();
  if (existing.includes(database)) return;
  await client.command(`create database ${database}`);
}
