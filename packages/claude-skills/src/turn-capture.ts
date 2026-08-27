import type { Client } from "./agent-memory/index.js";
import type { TranscriptTurn } from "./transcript-turns.js";
import { extractRefs, refId, type Ref } from "./refs.js";

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
    await writeRefs(client, db, id, extractRefs(t.text));
    written.push({ id, line: t.line });
  }
  return written;
}

/** MERGE the :Ref nodes a turn names and link the turn to them. Idempotent. */
export async function writeRefs(client: Client, db: string, turnId: string, refs: Ref[]): Promise<number> {
  for (const r of refs) {
    const id = refId(r);
    await client.execute(db, "cypher",
      `MERGE (r:Ref {id: ${cypherStr(id)}})
       SET r.kind = ${cypherStr(r.kind)}, r.value = ${cypherStr(r.value)}, r.valueLc = ${cypherStr(r.value.toLowerCase())}`);
    await client.execute(db, "cypher",
      `MATCH (t:Turn {id: ${cypherStr(turnId)}}), (r:Ref {id: ${cypherStr(id)}})
       WHERE NOT (t)-[:MENTIONS]->(r) CREATE (t)-[:MENTIONS]->(r)`);
  }
  return refs.length;
}

/** Link refs for every Turn that has none yet (turns captured before 0.10.0). */
export async function backfillRefs(client: Client, db: string): Promise<{ turns: number; refs: number }> {
  let turns = 0;
  let refs = 0;
  const rows = await client.query<{ id: string; text: string }>(db, "cypher",
    `MATCH (t:Turn) WHERE NOT (t)-[:MENTIONS]->() RETURN t.id AS id, t.text AS text`);
  for (const row of rows) {
    const found = extractRefs(row.text ?? "");
    if (found.length === 0) continue;
    refs += await writeRefs(client, db, row.id, found);
    turns += 1;
  }
  return { turns, refs };
}

function cypherStr(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
