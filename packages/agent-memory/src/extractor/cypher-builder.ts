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
}

function quote(v: unknown): string {
  return '"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function propsClause(label: string, props: Record<string, unknown>, naturalKeys: Record<string, string[]>): string {
  const key = (naturalKeys[label] ?? [])[0];
  if (!key) throw new Error(`no natural key for label ${label}`);
  return `{${key}:${quote(props[key])}}`;
}

export function buildExtractorCypher(args: BuildArgs): string {
  const { triple, sessionDbId, naturalKeys } = args;
  const sub = propsClause(triple.subject.label, triple.subject.props, naturalKeys);
  const obj = propsClause(triple.object.label, triple.object.props, naturalKeys);
  const conf = triple.confidence != null ? `,\n                r.confidence = ${triple.confidence}` : "";

  return `MERGE (s:${triple.subject.label} ${sub})
  ON CREATE SET s.firstSeenAt = datetime()
MERGE (o:${triple.object.label} ${obj})
  ON CREATE SET o.firstSeenAt = datetime()
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
