import { randomUUID } from "node:crypto";
import type { Client } from "../client.js";

export async function startSession(
  client: Client,
  db: string,
  input: { repo?: string } = {},
): Promise<string> {
  const id = randomUUID();
  const repoClause = input.repo ? `, repo: ${cypherStr(input.repo)}` : "";
  await client.execute(db, "cypher",
    `CREATE (s:Session { id: ${cypherStr(id)}, startedAt: datetime(${cypherStr(new Date().toISOString())})${repoClause} })`);
  return id;
}

export async function endSession(client: Client, db: string, id: string, summary?: string): Promise<void> {
  const summaryClause = summary ? `, s.summary = ${cypherStr(summary)}` : "";
  await client.execute(db, "cypher",
    `MATCH (s:Session {id: ${cypherStr(id)}}) SET s.endedAt = datetime(${cypherStr(new Date().toISOString())})${summaryClause}`);
}

export async function findLatestSessionForRepo(
  client: Client,
  db: string,
  repo: string,
  excludeId?: string,
): Promise<string | null> {
  const excludeClause = excludeId ? ` AND s.id <> ${cypherStr(excludeId)}` : "";
  const rows = await client.query<{ "s.id": string }>(
    db,
    "cypher",
    `MATCH (s:Session) WHERE s.repo = ${cypherStr(repo)}${excludeClause}
     RETURN s.id ORDER BY s.startedAt DESC LIMIT 1`,
  );
  return rows[0]?.["s.id"] ?? null;
}

function cypherStr(s: string): string {
  return `'${s.replace(/'/g, "\\'")}'`;
}
