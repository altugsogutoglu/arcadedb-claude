import { randomUUID } from "node:crypto";
import type { Client } from "../client.js";

export interface DecisionInput {
  summary: string;
  rationale: string;
  repo: string;
}

export interface Decision {
  id: string;
  summary: string;
  rationale: string;
  decidedAt: string;
  repo: string;
}

export async function recordDecision(client: Client, db: string, input: DecisionInput): Promise<string> {
  const id = randomUUID();
  const cypher = `
    CREATE (d:Decision {
      id: ${cypherStr(id)},
      summary: ${cypherStr(input.summary)},
      rationale: ${cypherStr(input.rationale)},
      decidedAt: datetime(${cypherStr(new Date().toISOString())}),
      repo: ${cypherStr(input.repo)}
    })
  `;
  await client.execute(db, "cypher", cypher);
  return id;
}

export async function queryDecisions(
  client: Client,
  db: string,
  filter: { repo?: string },
): Promise<Decision[]> {
  const where = filter.repo ? `WHERE d.repo = ${cypherStr(filter.repo)}` : "";
  const rows = await client.query<{ "d.id": string; "d.summary": string; "d.rationale": string; "d.decidedAt": string; "d.repo": string }>(
    db, "cypher",
    `MATCH (d:Decision) ${where} RETURN d.id, d.summary, d.rationale, d.decidedAt, d.repo ORDER BY d.decidedAt DESC`,
  );
  return rows.map(r => ({
    id: r["d.id"], summary: r["d.summary"], rationale: r["d.rationale"],
    decidedAt: r["d.decidedAt"], repo: r["d.repo"],
  }));
}

function cypherStr(s: string): string {
  return `'${s.replace(/'/g, "\\'")}'`;
}
