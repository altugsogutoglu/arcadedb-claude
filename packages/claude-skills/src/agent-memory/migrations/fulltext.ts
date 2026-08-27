import type { Client } from "../client.js";

const BATCH = 200;

/**
 * Re-write `prop` on every row of `type` so a freshly created FULL_TEXT index sees it.
 * A same-value write is skipped by ArcadeDB, so the value goes through a real change and back.
 */
export async function backfillFullText(client: Client, db: string, type: string, prop: string): Promise<number> {
  let done = 0;
  let skip = 0;
  for (;;) {
    const rows = await client.query<{ rid: string; v: string | null }>(db, "sql",
      `SELECT @rid AS rid, ${prop} AS v FROM ${type} WHERE ${prop} IS NOT NULL SKIP ${skip} LIMIT ${BATCH}`);
    if (rows.length === 0) break;
    for (const r of rows) {
      if (typeof r.v !== "string") continue;
      const lit = sqlStr(r.v);
      await client.execute(db, "sql", `UPDATE ${r.rid} SET ${prop} = ${lit} + ' '`);
      await client.execute(db, "sql", `UPDATE ${r.rid} SET ${prop} = ${lit}`);
      done += 1;
    }
    skip += rows.length;
    if (rows.length < BATCH) break;
  }
  return done;
}

export function sqlStr(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
