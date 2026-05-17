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

function cypherStr(s: string): string {
  return `'${s.replace(/'/g, "\\'")}'`;
}
