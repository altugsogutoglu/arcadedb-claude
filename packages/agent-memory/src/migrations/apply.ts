import type { Client } from "../client.js";
import { allSchemas, type SchemaDomain } from "../schemas/all.js";
import { renderSchema } from "./render.js";

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
      await client.execute(database, "sql", stmt);
    }
  }
}

async function ensureDatabase(client: Client, database: string): Promise<void> {
  const existing = await client.listDatabases();
  if (existing.includes(database)) return;
  await client.command(`create database ${database}`);
}
