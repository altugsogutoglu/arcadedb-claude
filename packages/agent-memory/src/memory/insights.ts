import { randomUUID } from "node:crypto";
import type { Client } from "../client.js";

export interface InsightInput {
  topic: string;
  text: string;
  repo?: string;
}

export interface Insight {
  id: string;
  topic: string;
  text: string;
  createdAt: string;
  repo: string | null;
}

export async function recordInsight(client: Client, db: string, input: InsightInput): Promise<string> {
  const id = randomUUID();
  const repoClause = input.repo ? `, repo: ${cypherStr(input.repo)}` : "";
  const cypher = `
    CREATE (i:Insight {
      id: ${cypherStr(id)},
      topic: ${cypherStr(input.topic)},
      text: ${cypherStr(input.text)},
      createdAt: datetime(${cypherStr(new Date().toISOString())})${repoClause}
    })
  `;
  await client.execute(db, "cypher", cypher);
  return id;
}

export async function queryInsights(
  client: Client,
  db: string,
  filter: { topic?: string; repo?: string },
): Promise<Insight[]> {
  const clauses: string[] = [];
  if (filter.topic) clauses.push(`i.topic = ${cypherStr(filter.topic)}`);
  if (filter.repo) clauses.push(`i.repo = ${cypherStr(filter.repo)}`);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await client.query<{ "i.id": string; "i.topic": string; "i.text": string; "i.createdAt": string; "i.repo": string | null }>(
    db, "cypher",
    `MATCH (i:Insight) ${where} RETURN i.id, i.topic, i.text, i.createdAt, i.repo ORDER BY i.createdAt DESC`,
  );
  return rows.map(r => ({
    id: r["i.id"], topic: r["i.topic"], text: r["i.text"],
    createdAt: r["i.createdAt"], repo: r["i.repo"] ?? null,
  }));
}

function cypherStr(s: string): string {
  return `'${s.replace(/'/g, "\\'")}'`;
}
