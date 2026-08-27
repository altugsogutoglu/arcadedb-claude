import type { Client } from "../agent-memory/index.js";

function q(s: string | number | undefined | null): string {
  if (s === undefined || s === null) return "null";
  if (typeof s === "number") return String(s);
  return `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export interface RepoInput { name: string; path: string; stack?: string }
export interface ModuleInput { name: string; path: string; language?: string }
export interface FileInput { path: string; language: string; loc?: number; hash?: string }

export async function upsertRepo(client: Client, db: string, repo: RepoInput): Promise<void> {
  const cy = `
    MERGE (r:Repo {name: ${q(repo.name)}})
    SET r.path = ${q(repo.path)},
        r.stack = ${q(repo.stack)},
        r.lastIndexedAt = datetime(${q(new Date().toISOString())})
  `;
  await client.execute(db, "cypher", cy);
}

export async function upsertModule(client: Client, db: string, mod: ModuleInput): Promise<void> {
  const cy = `
    MERGE (m:Module {path: ${q(mod.path)}})
    SET m.name = ${q(mod.name)},
        m.language = ${q(mod.language)}
  `;
  await client.execute(db, "cypher", cy);
}

export async function upsertFile(client: Client, db: string, file: FileInput): Promise<void> {
  const cy = `
    MERGE (f:File {path: ${q(file.path)}})
    SET f.language = ${q(file.language)},
        f.loc = ${q(file.loc)},
        f.hash = ${q(file.hash)},
        f.modifiedAt = datetime(${q(new Date().toISOString())})
  `;
  await client.execute(db, "cypher", cy);
}

export async function linkContains(
  client: Client,
  db: string,
  parentLabel: string,
  parentKey: Record<string, string>,
  childLabel: string,
  childKey: Record<string, string>,
): Promise<void> {
  const pk = Object.entries(parentKey).map(([k, v]) => `${k}: ${q(v)}`).join(", ");
  const ck = Object.entries(childKey).map(([k, v]) => `${k}: ${q(v)}`).join(", ");
  const cy = `
    MATCH (p:${parentLabel} {${pk}})
    MATCH (c:${childLabel} {${ck}})
    MERGE (p)-[:CONTAINS]->(c)
  `;
  await client.execute(db, "cypher", cy);
}

export async function linkImports(
  client: Client,
  db: string,
  fromPath: string,
  toPath: string | null,
  unresolvedSpec?: string,
): Promise<void> {
  if (toPath) {
    const cy = `
      MATCH (a:File {path: ${q(fromPath)}})
      MATCH (b:File {path: ${q(toPath)}})
      MERGE (a)-[:IMPORTS]->(b)
    `;
    await client.execute(db, "cypher", cy);
    return;
  }
  if (unresolvedSpec) {
    const cy = `
      MATCH (f:File {path: ${q(fromPath)}})
      SET f.unresolvedImports = coalesce(f.unresolvedImports, '') + ${q(unresolvedSpec + ",")}
    `;
    await client.execute(db, "cypher", cy);
  }
}

export async function linkImportsToModule(
  client: Client,
  db: string,
  fromFilePath: string,
  modulePath: string,
): Promise<void> {
  const cy = `
    MATCH (a:File {path: ${q(fromFilePath)}})
    MATCH (m:Module {path: ${q(modulePath)}})
    MERGE (a)-[:IMPORTS]->(m)
  `;
  await client.execute(db, "cypher", cy);
}
