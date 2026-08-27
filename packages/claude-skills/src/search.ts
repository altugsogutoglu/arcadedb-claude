import type { Client } from "./agent-memory/index.js";
import { EMBEDDED_TYPES, type EmbeddedType } from "./agent-memory/index.js";
import type { Embedder } from "./embed.js";
import { TEXT_EXPR } from "./embed-runner.js";
import { personalizedPageRank, hubDamping } from "./ppr.js";

export type SearchMode = "hybrid" | "vector" | "text";

export interface TurnBrief {
  id: string;
  role: string | null;
  repo: string | null;
  at: string | null;
  text: string;
}

export interface SearchHit {
  type: EmbeddedType;
  /** Fused rank score (reciprocal rank fusion); comparable only within one search. */
  score: number;
  /** Which retrievers ranked this node. */
  via: ("vector" | "text" | "ref" | "graph")[];
  text: string;
  repo: string | null;
  at: string | null;
  sessionId: string | null;
  rid: string;
  /** Decision hits only: the window is closed, a newer decision replaced it. */
  superseded?: boolean;
  validTo?: string | null;
  /** Turn hits only: the turns just before and after in the same session. */
  context?: { before: TurnBrief[]; after: TurnBrief[] };
  /** Turn hits only: turns from other sessions naming the same file, symbol, commit or ticket. */
  related?: TurnBrief[];
}

export interface SearchOptions {
  limit?: number;
  types?: readonly EmbeddedType[];
  repo?: string;
  mode?: SearchMode;
  /** Turns of context on each side of a Turn hit; 0 disables expansion. */
  context?: number;
  /** Related turns (shared refs) per Turn hit; 0 disables. */
  related?: number;
  /** Include decisions whose validity window is closed (superseded). Default false. */
  includeSuperseded?: boolean;
  /** Point-in-time view: only what was known and valid at this ISO instant. */
  asOf?: string;
  /** Query-time personalized PageRank from the retriever hits over refs/sessions/supersession. Default on. */
  graph?: boolean;
  /** Expansion radius for the PageRank subgraph. Default 2. */
  hops?: number;
}

const AT_EXPR: Record<EmbeddedType, string> = {
  Turn: "ts",
  Decision: "decidedAt",
  Insight: "createdAt",
  Question: "askedAt",
  Answer: "answeredAt",
  Session: "summarizedAt",
  Digest: "createdAt",
};

/** What the type is called in output: a summarised :Session reads as a Summary. */
const DISPLAY: Partial<Record<EmbeddedType, string>> = { Session: "Summary" };

/** Properties with a FULL_TEXT index, per type (see schemas/memory.ts). */
const TEXT_INDEXED: Record<EmbeddedType, string[]> = {
  Turn: ["text"],
  Decision: ["summary", "rationale"],
  Insight: ["topic", "text"],
  Question: ["text"],
  Answer: ["text"],
  Session: ["summary"],
  Digest: ["text"],
};

/** Standard RRF constant: 60 flattens the top of each list so no single retriever dominates. */
const RRF_K = 60;
/** Candidates pulled from each retriever per type, relative to the requested limit. */
const CANDIDATE_FACTOR = 3;

/**
 * Reciprocal rank fusion over ranked candidate lists. Each list is an ordered array of keys;
 * a key's score is the sum of 1/(k+rank) across the lists that contain it.
 */
export function fuseRanks(lists: Record<string, string[]>, k = RRF_K): { key: string; score: number; via: string[] }[] {
  const acc = new Map<string, { score: number; via: string[] }>();
  for (const [name, keys] of Object.entries(lists)) {
    keys.forEach((key, rank) => {
      const cur = acc.get(key) ?? { score: 0, via: [] };
      cur.score += 1 / (k + rank + 1);
      if (!cur.via.includes(name)) cur.via.push(name);
      acc.set(key, cur);
    });
  }
  return [...acc.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.score - a.score);
}

/**
 * Turn free text into a Lucene query the FULL_TEXT index accepts: every token quoted (so
 * `config/heisterkamp.php` and `BACKLOG:69` survive the lexer), tokens OR-ed, empty when nothing usable remains.
 */
export function luceneQuery(query: string): string {
  const tokens = query.split(/\s+/).map(t => t.replace(/["\\]/g, "").replace(/^[^\w./:#-]+|[^\w./:#-]+$/g, "")).filter(t => t.length > 1);
  return tokens.map(t => `"${t}"`).join(" ");
}

export function queryTokens(query: string): string[] {
  return query.split(/\s+/).map(t => t.replace(/^[^\w./:#-]+|[^\w./:#-]+$/g, "").toLowerCase()).filter(t => t.length > 2);
}

function sqlStr(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/**
 * Bi-temporal scoping. Default: superseded decisions are hidden. `asOf`: decisions valid at that instant,
 * everything else created at or before it.
 */
export function temporalClause(type: EmbeddedType, opts: { includeSuperseded?: boolean; asOf?: string }): string {
  if (opts.asOf) {
    const t = sqlStr(opts.asOf);
    if (type === "Decision") return ` AND coalesce(validFrom, decidedAt) <= ${t} AND (validTo IS NULL OR validTo > ${t})`;
    return ` AND ${AT_EXPR[type]} <= ${t}`;
  }
  if (type === "Decision" && !opts.includeSuperseded) return " AND validTo IS NULL";
  return "";
}

/**
 * Hybrid search: vector similarity, full-text and ref lookup each rank candidates, RRF fuses them,
 * the top hits are hydrated and (for Turns) expanded with session context and related turns.
 * Pass `embed: null` (or mode "text") when the embedding runtime is not available.
 */
export async function hybridSearch(
  client: Client,
  db: string,
  embed: Embedder | null,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchHit[]> {
  const limit = opts.limit ?? 10;
  const types = opts.types ?? EMBEDDED_TYPES;
  const mode: SearchMode = opts.mode ?? (embed ? "hybrid" : "text");
  const useVector = mode !== "text" && embed !== null;
  const useText = mode !== "vector";
  const candidates = limit * CANDIDATE_FACTOR;
  const repoClause = opts.repo ? ` AND repo = ${sqlStr(opts.repo)}` : "";
  const scope = (type: EmbeddedType): string => repoClause + temporalClause(type, opts);

  let vecLiteral: string | null = null;
  if (useVector) {
    const [vec] = await embed!([query]);
    vecLiteral = `[${vec!.map(v => v.toFixed(6)).join(",")}]`;
  }
  const lucene = useText ? luceneQuery(query) : "";
  const tokens = queryTokens(query);

  const lists: Record<string, string[]> = {};
  const typeOf = new Map<string, EmbeddedType>();
  const remember = (type: EmbeddedType, rids: string[]): string[] => {
    for (const r of rids) typeOf.set(r, type);
    return rids;
  };

  for (const type of types) {
    if (vecLiteral) {
      const rows = await client.query<{ rid: string }>(db, "sql",
        `SELECT @rid AS rid, vectorCosineSimilarity(embedding, ${vecLiteral}) AS score
         FROM ${type} WHERE embedding IS NOT NULL${scope(type)} ORDER BY score DESC LIMIT ${candidates}`);
      (lists["vector"] ??= []).push(...remember(type, rows.map(r => r.rid)));
    }
    if (lucene) {
      for (const prop of TEXT_INDEXED[type]) {
        const rows = await client.query<{ rid: string }>(db, "sql",
          `SELECT @rid AS rid, $score AS score FROM ${type}
           WHERE SEARCH_INDEX(${sqlStr(`${type}[${prop}]`)}, ${sqlStr(lucene)}) = true${scope(type)}
           ORDER BY score DESC LIMIT ${candidates}`).catch(() => [] as { rid: string }[]);
        (lists["text"] ??= []).push(...remember(type, rows.map(r => r.rid)));
      }
    }
  }
  if (useText && tokens.length > 0 && types.includes("Turn")) {
    const rows = await client.query<{ rid: string }>(db, "sql",
      `SELECT @rid AS rid FROM (SELECT expand(in('MENTIONS')) FROM Ref WHERE valueLc IN [${tokens.map(sqlStr).join(",")}])
       WHERE @type = 'Turn'${scope("Turn")} LIMIT ${candidates}`).catch(() => [] as { rid: string }[]);
    (lists["ref"] ??= []).push(...remember("Turn", rows.map(r => r.rid)));
  }

  // Vector lists are per type and ordered by score inside each type only; re-rank across types by re-sorting
  // is not possible without scores, so keep insertion order (types in the order requested). Acceptable for RRF.
  if (opts.graph !== false) {
    const seeds = fuseRanks(lists).slice(0, candidates);
    if (seeds.length > 0) {
      const ranked = await graphRank(client, db, new Map(seeds.map(s => [s.key, s.score])), opts.hops ?? 2, typeOf, types, opts);
      if (ranked.length > 0) lists["graph"] = ranked.slice(0, candidates);
    }
  }
  const fused = fuseRanks(lists).slice(0, limit);
  const hits = await hydrate(client, db, fused.map(f => ({ rid: f.key, type: typeOf.get(f.key)!, score: f.score, via: f.via as SearchHit["via"] })));

  const ctx = opts.context ?? 1;
  const rel = opts.related ?? 3;
  for (const h of hits) {
    if (h.type !== "Turn") continue;
    if (ctx > 0) h.context = await turnContext(client, db, h, ctx);
    if (rel > 0) h.related = await relatedTurns(client, db, h.rid, rel);
  }
  return hits;
}

const GRAPH_EDGES = "'MENTIONS','DURING','COVERS','SUPERSEDES','FOLLOWS'";
const MAX_SUBGRAPH_NODES = 5000;

/**
 * Pull the `hops`-neighbourhood of the seeds, run personalized PageRank on it and return the result
 * nodes (of a requested, searchable type, inside the repo/time scope) best ranked by the walk.
 */
async function graphRank(
  client: Client, db: string, seeds: Map<string, number>, hops: number,
  typeOf: Map<string, EmbeddedType>, types: readonly EmbeddedType[], opts: SearchOptions,
): Promise<string[]> {
  const neighbors = new Map<string, string[]>();
  const nodeType = new Map<string, string>();
  for (const [rid, t] of typeOf) nodeType.set(rid, t);
  let frontier = [...seeds.keys()];
  const seen = new Set(frontier);
  for (let hop = 0; hop < hops && frontier.length > 0 && seen.size < MAX_SUBGRAPH_NODES; hop++) {
    const next: string[] = [];
    for (let i = 0; i < frontier.length; i += 200) {
      const batch = frontier.slice(i, i + 200);
      const rows = await client.query<{ rid: string; type: string; nbrs: string[]; ntypes: string[] }>(db, "sql",
        `SELECT @rid AS rid, @type AS type, both(${GRAPH_EDGES}).@rid AS nbrs, both(${GRAPH_EDGES}).@type AS ntypes FROM [${batch.join(",")}]`).catch(() => []);
      for (const r of rows) {
        nodeType.set(r.rid, r.type);
        const list = neighbors.get(r.rid) ?? [];
        (r.nbrs ?? []).forEach((n, j) => {
          list.push(n);
          nodeType.set(n, r.ntypes?.[j] ?? "?");
          (neighbors.get(n) ?? neighbors.set(n, []).get(n)!).push(r.rid);
          if (!seen.has(n)) { seen.add(n); next.push(n); }
        });
        neighbors.set(r.rid, list);
      }
    }
    frontier = next;
  }
  if (neighbors.size === 0) return [];
  // Dedupe adjacency lists (an edge seen from both ends appears twice).
  for (const [k, v] of neighbors) neighbors.set(k, [...new Set(v)]);
  const degree = (n: string): number => neighbors.get(n)?.length ?? 0;
  const damp = hubDamping(degree);
  const rank = personalizedPageRank({ neighbors }, seeds, { nodeWeight: n => (nodeType.get(n) === "Ref" ? damp(n) : 1) });

  const wanted = new Set<string>(types);
  const candidates = [...rank.entries()]
    .filter(([rid]) => wanted.has(nodeType.get(rid) ?? ""))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 200)
    .map(([rid]) => rid);
  if (candidates.length === 0) return [];
  // Keep only nodes that pass the same repo / time scope as the other retrievers, and record their type.
  const kept: string[] = [];
  for (const t of types) {
    const ofType = candidates.filter(r => nodeType.get(r) === t);
    if (ofType.length === 0) continue;
    const repoClause = opts.repo ? ` AND repo = ${sqlStr(opts.repo)}` : "";
    const rows = await client.query<{ rid: string }>(db, "sql",
      `SELECT @rid AS rid FROM ${t} WHERE @rid IN [${ofType.join(",")}]${repoClause}${temporalClause(t, opts)}${t === "Session" ? " AND summary IS NOT NULL AND summary <> ''" : ""}`).catch(() => []);
    const ok = new Set(rows.map(r => r.rid));
    for (const r of ofType) if (ok.has(r)) { kept.push(r); typeOf.set(r, t); }
  }
  // Preserve PageRank order across types.
  const order = new Map(candidates.map((r, i) => [r, i]));
  return kept.sort((a, b) => order.get(a)! - order.get(b)!);
}

/** @deprecated use hybridSearch; kept for callers that pass an embedder and want vector-only ranking. */
export async function semanticSearch(client: Client, db: string, embed: Embedder, query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
  return hybridSearch(client, db, embed, query, { ...opts, mode: "vector", context: opts.context ?? 0, related: opts.related ?? 0 });
}

async function hydrate(client: Client, db: string, items: { rid: string; type: EmbeddedType; score: number; via: SearchHit["via"] }[]): Promise<SearchHit[]> {
  const byType = new Map<EmbeddedType, typeof items>();
  for (const it of items) (byType.get(it.type) ?? byType.set(it.type, []).get(it.type)!).push(it);
  const out = new Map<string, SearchHit>();
  for (const [type, group] of byType) {
    const rows = await client.query<{ rid: string; body: string; repo?: string; at?: string; sessionId?: string; idx?: number; validTo?: string | null }>(db, "sql",
      `SELECT @rid AS rid, ${TEXT_EXPR[type]} AS body, repo, ${AT_EXPR[type]} AS at, ${type === "Turn" ? "sessionId, idx" : type === "Session" ? "id AS sessionId, null AS idx" : "null AS sessionId, null AS idx"},
              ${type === "Decision" ? "validTo" : "null AS validTo"}
       FROM ${type} WHERE @rid IN [${group.map(g => g.rid).join(",")}]`);
    for (const r of rows) {
      const it = group.find(g => g.rid === r.rid)!;
      const hit: SearchHit & { idx?: number } = { type, score: it.score, via: it.via, text: r.body ?? "", repo: r.repo ?? null, at: r.at ?? null, sessionId: r.sessionId ?? null, rid: r.rid };
      if (r.idx != null) hit.idx = r.idx;
      if (type === "Decision" && r.validTo) { hit.superseded = true; hit.validTo = String(r.validTo); }
      out.set(r.rid, hit);
    }
  }
  return items.map(i => out.get(i.rid)).filter((h): h is SearchHit => !!h);
}

async function turnContext(client: Client, db: string, hit: SearchHit, n: number): Promise<{ before: TurnBrief[]; after: TurnBrief[] }> {
  const idx = (hit as SearchHit & { idx?: number }).idx;
  if (!hit.sessionId || idx == null) return { before: [], after: [] };
  const sel = "SELECT id, role, repo, ts AS at, text FROM Turn WHERE sessionId = " + sqlStr(hit.sessionId);
  const before = await client.query<TurnBrief>(db, "sql", `${sel} AND idx < ${idx} ORDER BY idx DESC LIMIT ${n}`);
  const after = await client.query<TurnBrief>(db, "sql", `${sel} AND idx > ${idx} ORDER BY idx ASC LIMIT ${n}`);
  return { before: before.reverse(), after };
}

async function relatedTurns(client: Client, db: string, rid: string, n: number): Promise<TurnBrief[]> {
  const rows = await client.query<TurnBrief & { sessionId: string }>(db, "sql",
    `SELECT id, role, repo, ts AS at, text, sessionId FROM (
       SELECT expand(out('MENTIONS').in('MENTIONS')) FROM ${rid}
     ) WHERE @rid <> ${rid} ORDER BY ts DESC LIMIT ${n * 10}`).catch(() => [] as (TurnBrief & { sessionId: string })[]);
  const own = await client.query<{ sessionId: string }>(db, "sql", `SELECT sessionId FROM ${rid}`).catch(() => []);
  const ownSession = own[0]?.sessionId;
  const seen = new Set<string>();
  const out: TurnBrief[] = [];
  for (const r of rows) {
    if (r.sessionId === ownSession || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ id: r.id, role: r.role, repo: r.repo, at: r.at, text: r.text });
    if (out.length >= n) break;
  }
  return out;
}

export function formatHits(hits: SearchHit[], maxChars = 400): string {
  if (hits.length === 0) return "no matches (nothing captured or indexed yet)";
  const clip = (t: string, n: number): string => (t.length > n ? t.slice(0, n) + "..." : t).replace(/\n/g, " ");
  return hits.map((h, i) => {
    const text = h.text.length > maxChars ? h.text.slice(0, maxChars) + "..." : h.text;
    const meta = [DISPLAY[h.type] ?? h.type, h.repo, h.at ? h.at.slice(0, 16) : null, h.via.join("+"), h.superseded ? `superseded ${String(h.validTo).slice(0, 10)}` : null].filter(Boolean).join(" | ");
    const lines = [`${i + 1}. [${h.score.toFixed(3)}] ${meta}`, `   ${text.replace(/\n/g, "\n   ")}`];
    for (const b of h.context?.before ?? []) lines.push(`   ↑ ${b.role ?? "?"}: ${clip(b.text, 120)}`);
    for (const a of h.context?.after ?? []) lines.push(`   ↓ ${a.role ?? "?"}: ${clip(a.text, 120)}`);
    for (const r of h.related ?? []) lines.push(`   ~ ${r.repo ?? "?"} ${r.at ? r.at.slice(0, 10) : ""}: ${clip(r.text, 120)}`);
    return lines.join("\n");
  }).join("\n");
}
