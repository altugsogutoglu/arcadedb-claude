export interface BuildArgs {
  triple: {
    subject: { label: string; props: Record<string, unknown> };
    verb: string;
    object: { label: string; props: Record<string, unknown> };
    evidence: string;
    confidence?: number;
  };
  sessionDbId: string;
  naturalKeys: Record<string, string[]>;
  /** Repo the session ran in; stamped on both nodes when they have none, so `search --repo` finds notes too. */
  repo?: string | null;
}

function quote(v: unknown): string {
  return '"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function naturalKey(label: string, naturalKeys: Record<string, string[]>): string {
  const key = (naturalKeys[label] ?? [])[0];
  if (!key) throw new Error(`no natural key for label ${label}`);
  return key;
}

function propsClause(label: string, props: Record<string, unknown>, naturalKeys: Record<string, string[]>): string {
  const key = naturalKey(label, naturalKeys);
  return `{${key}:${quote(props[key])}}`;
}

/** Timestamp the schema expects on a note, filled with now() when the extractor did not supply it. */
const CREATED_AT: Record<string, string> = {
  Decision: "decidedAt",
  Insight: "createdAt",
  Question: "askedAt",
  Answer: "answeredAt",
};

function literal(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return String(v);
  if (typeof v === "string") return quote(v);
  return null;
}

/**
 * `SET alias.prop = value` for every scalar prop except the natural key, so the node
 * carries its text (summary, rationale, topic, text, ...) and not just its id.
 * Applied on both create and match: a node first seen without text gets it later.
 */
function setProps(alias: string, label: string, props: Record<string, unknown>, naturalKeys: Record<string, string[]>): string {
  const key = naturalKey(label, naturalKeys);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(props)) {
    if (k === key) continue;
    const lit = literal(v);
    if (lit === null) continue;
    parts.push(`${alias}.${k} = ${lit}`);
  }
  return parts.length ? `\nSET ${parts.join(",\n    ")}` : "";
}

function onCreate(alias: string, label: string, props: Record<string, unknown>): string {
  const ts = CREATED_AT[label];
  const extra = ts && props[ts] === undefined ? `, ${alias}.${ts} = datetime()` : "";
  return `ON CREATE SET ${alias}.firstSeenAt = datetime()${extra}`;
}

/** Stamp the session's repo on a note that has none (also backfills on replay); an explicit repo prop wins. */
function setRepo(alias: string, props: Record<string, unknown>, repo?: string | null): string {
  if (!repo || props["repo"] !== undefined) return "";
  return `\nSET ${alias}.repo = coalesce(${alias}.repo, ${quote(repo)})`;
}

export function buildExtractorCypher(args: BuildArgs): string {
  const { triple, sessionDbId, naturalKeys, repo } = args;
  const sub = propsClause(triple.subject.label, triple.subject.props, naturalKeys);
  const obj = propsClause(triple.object.label, triple.object.props, naturalKeys);
  const conf = triple.confidence != null ? `,\n                r.confidence = ${triple.confidence}` : "";

  return `MERGE (s:${triple.subject.label} ${sub})
  ${onCreate("s", triple.subject.label, triple.subject.props)}${setProps("s", triple.subject.label, triple.subject.props, naturalKeys)}${setRepo("s", triple.subject.props, repo)}
MERGE (o:${triple.object.label} ${obj})
  ${onCreate("o", triple.object.label, triple.object.props)}${setProps("o", triple.object.label, triple.object.props, naturalKeys)}${setRepo("o", triple.object.props, repo)}
MERGE (s)-[r:${triple.verb}]->(o)
  ON CREATE SET r.firstAt = datetime(),
                r.session = ${quote(sessionDbId)},
                r.evidence = ${quote(triple.evidence)}${conf},
                r.count = 1
  ON MATCH  SET r.lastAt = datetime(),
                r.count = coalesce(r.count, 1) + 1
MERGE (sess:Session {id: ${quote(sessionDbId)}})
MERGE (s)-[:DURING]->(sess)`;
}
