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

/**
 * Create (later)-[:FOLLOWS]->(earlier) between two existing :Session nodes.
 * Uses MERGE so calling twice produces a single edge.
 */
export async function linkFollows(
  client: Client,
  db: string,
  laterSessionId: string,
  earlierSessionId: string,
): Promise<void> {
  const cypher = `
    MATCH (later:Session {id: ${cypherStr(laterSessionId)}}),
          (earlier:Session {id: ${cypherStr(earlierSessionId)}})
    MERGE (later)-[:FOLLOWS]->(earlier)
  `;
  await client.execute(db, "cypher", cypher);
}

/**
 * Attach a memory node (Decision/Insight/Question/Answer) to a Session
 * via :DURING. Idempotent.
 */
export async function linkDuring(
  client: Client,
  db: string,
  nodeLabel: "Decision" | "Insight" | "Question" | "Answer",
  nodeId: string,
  sessionId: string,
): Promise<void> {
  const cypher = `
    MATCH (n:${nodeLabel} {id: ${cypherStr(nodeId)}}),
          (s:Session {id: ${cypherStr(sessionId)}})
    MERGE (n)-[:DURING]->(s)
  `;
  await client.execute(db, "cypher", cypher);
}
