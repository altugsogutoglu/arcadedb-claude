import { randomUUID } from "node:crypto";
import type { Client } from "../client.js";
import { linkDuring } from "./sessions.js";

export interface DecisionInput {
  summary: string;
  rationale: string;
  repo: string;
  sessionId?: string;
  /** World time the decision started to hold; defaults to now. */
  validFrom?: string;
  /** Ids of decisions this one replaces; their validity window closes at `validFrom`. */
  supersedes?: string[];
}

export interface Decision {
  id: string;
  summary: string;
  rationale: string;
  decidedAt: string;
  repo: string;
  validFrom: string | null;
  validTo: string | null;
  expiredAt: string | null;
  supersededBy: string | null;
}

export async function recordDecision(client: Client, db: string, input: DecisionInput): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const validFrom = input.validFrom ?? now;
  const cypher = `
    CREATE (d:Decision {
      id: ${cypherStr(id)},
      summary: ${cypherStr(input.summary)},
      rationale: ${cypherStr(input.rationale)},
      decidedAt: datetime(${cypherStr(now)}),
      validFrom: datetime(${cypherStr(validFrom)}),
      repo: ${cypherStr(input.repo)}
    })
  `;
  await client.execute(db, "cypher", cypher);
  if (input.sessionId) {
    await linkDuring(client, db, "Decision", id, input.sessionId);
  }
  for (const old of input.supersedes ?? []) {
    await supersedeDecision(client, db, id, old, validFrom);
  }
  return id;
}

/**
 * (new)-[:SUPERSEDES]->(old) and close the old decision's validity window. Idempotent; nothing is deleted,
 * so `--as-of` queries still see the old decision inside its window.
 */
export async function supersedeDecision(client: Client, db: string, newId: string, oldId: string, at?: string): Promise<boolean> {
  const now = new Date().toISOString();
  const atClause = at ? `datetime(${cypherStr(at)})` : "coalesce(n.validFrom, n.decidedAt)";
  const rows = await client.execute<{ id: string }>(db, "cypher",
    `MATCH (n:Decision {id: ${cypherStr(newId)}}), (o:Decision {id: ${cypherStr(oldId)}})
     WHERE n.id <> o.id
     MERGE (n)-[:SUPERSEDES]->(o)
     SET o.validTo = coalesce(o.validTo, ${atClause}),
         o.expiredAt = coalesce(o.expiredAt, datetime(${cypherStr(now)})),
         o.supersededBy = coalesce(o.supersededBy, n.id)
     RETURN o.id AS id`);
  return rows.length > 0;
}

/** Close windows for SUPERSEDES edges written before validity existed. Cheap and idempotent. */
export async function reconcileDecisions(client: Client, db: string): Promise<number> {
  const now = new Date().toISOString();
  const rows = await client.execute<{ id: string }>(db, "cypher",
    `MATCH (n:Decision)-[:SUPERSEDES]->(o:Decision)
     WHERE o.validTo IS NULL
     SET o.validTo = coalesce(n.validFrom, n.decidedAt),
         o.expiredAt = datetime(${cypherStr(now)}),
         o.supersededBy = n.id
     RETURN o.id AS id`);
  return rows.length;
}

export async function queryDecisions(
  client: Client,
  db: string,
  filter: { repo?: string; includeSuperseded?: boolean; asOf?: string } = {},
): Promise<Decision[]> {
  const conds: string[] = [];
  if (filter.repo) conds.push(`d.repo = ${cypherStr(filter.repo)}`);
  if (filter.asOf) {
    const t = `datetime(${cypherStr(filter.asOf)})`;
    conds.push(`coalesce(d.validFrom, d.decidedAt) <= ${t} AND (d.validTo IS NULL OR d.validTo > ${t})`);
  } else if (!filter.includeSuperseded) {
    conds.push("d.validTo IS NULL");
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = await client.query<Record<string, string | null>>(
    db, "cypher",
    `MATCH (d:Decision) ${where}
     RETURN d.id AS id, d.summary AS summary, d.rationale AS rationale, d.decidedAt AS decidedAt, d.repo AS repo,
            d.validFrom AS validFrom, d.validTo AS validTo, d.expiredAt AS expiredAt, d.supersededBy AS supersededBy
     ORDER BY d.decidedAt DESC`,
  );
  return rows.map(r => ({
    id: r["id"]!, summary: r["summary"] ?? "", rationale: r["rationale"] ?? "",
    decidedAt: r["decidedAt"]!, repo: r["repo"] ?? "",
    validFrom: r["validFrom"] ?? null, validTo: r["validTo"] ?? null, expiredAt: r["expiredAt"] ?? null, supersededBy: r["supersededBy"] ?? null,
  }));
}

function cypherStr(s: string): string {
  return `'${s.replace(/'/g, "\\'")}'`;
}
