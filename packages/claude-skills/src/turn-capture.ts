import type { Client } from "./agent-memory/index.js";
import type { TranscriptTurn } from "./transcript-turns.js";

export interface CapturedTurn {
  id: string;
  line: number;
}

/**
 * Write transcript turns as :Turn vertices linked DURING the :Session.
 * Idempotent per (session, line): a re-run over the same lines updates in place.
 */
export async function writeTurns(
  client: Client,
  db: string,
  args: { sessionDbId: string; repo: string | null; turns: TranscriptTurn[] },
): Promise<CapturedTurn[]> {
  const written: CapturedTurn[] = [];
  for (const t of args.turns) {
    const id = `${args.sessionDbId}:${t.line}`;
    const repoClause = args.repo ? `, t.repo = ${cypherStr(args.repo)}` : "";
    await client.execute(db, "cypher",
      `MERGE (t:Turn {id: ${cypherStr(id)}})
       SET t.sessionId = ${cypherStr(args.sessionDbId)}, t.idx = ${t.line}, t.role = ${cypherStr(t.role)},
           t.text = ${cypherStr(t.text)}, t.ts = datetime(${cypherStr(t.ts)})${repoClause}`);
    await client.execute(db, "cypher",
      `MATCH (t:Turn {id: ${cypherStr(id)}}), (s:Session {id: ${cypherStr(args.sessionDbId)}})
       WHERE NOT (t)-[:DURING]->(s) CREATE (t)-[:DURING]->(s)`);
    written.push({ id, line: t.line });
  }
  return written;
}

function cypherStr(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
