import type { Client } from "arcadedb-agent-memory";

function q(s: string | number | undefined | null): string {
  if (s === undefined || s === null) return "null";
  if (typeof s === "number") return String(s);
  return `'${String(s).replace(/'/g, "\\'")}'`;
}

export interface NoteInput {
  path: string;
  title: string;
  content: string;
  vault: string;
  createdAt?: string;
  modifiedAt?: string;
}

export interface TagInput {
  name: string;
  vault: string;
}

export async function upsertNote(client: Client, db: string, note: NoteInput): Promise<void> {
  const now = new Date().toISOString();
  const cy = `
    MERGE (n:Note {path: ${q(note.path)}})
    SET n.title = ${q(note.title)},
        n.content = ${q(note.content)},
        n.vault = ${q(note.vault)},
        n.createdAt = datetime(${q(note.createdAt ?? now)}),
        n.modifiedAt = datetime(${q(note.modifiedAt ?? now)})
  `;
  await client.execute(db, "cypher", cy);
}

export async function upsertTag(client: Client, db: string, tag: TagInput): Promise<void> {
  const cy = `
    MERGE (t:Tag {name: ${q(tag.name)}, vault: ${q(tag.vault)}})
  `;
  await client.execute(db, "cypher", cy);
}

export async function linkLinksTo(
  client: Client,
  db: string,
  fromPath: string,
  toPath: string | null,
  unresolvedTarget?: string,
): Promise<void> {
  if (toPath) {
    const cy = `
      MATCH (a:Note {path: ${q(fromPath)}})
      MATCH (b:Note {path: ${q(toPath)}})
      MERGE (a)-[:LINKS_TO]->(b)
    `;
    await client.execute(db, "cypher", cy);
    return;
  }
  if (unresolvedTarget) {
    const cy = `
      MATCH (n:Note {path: ${q(fromPath)}})
      SET n.unresolvedLinks = coalesce(n.unresolvedLinks, '') + ${q(unresolvedTarget + ",")}
    `;
    await client.execute(db, "cypher", cy);
  }
}

export async function linkTagged(
  client: Client,
  db: string,
  notePath: string,
  tagName: string,
  vault: string,
): Promise<void> {
  const cy = `
    MATCH (n:Note {path: ${q(notePath)}})
    MATCH (t:Tag {name: ${q(tagName)}, vault: ${q(vault)}})
    MERGE (n)-[:TAGGED]->(t)
  `;
  await client.execute(db, "cypher", cy);
}
