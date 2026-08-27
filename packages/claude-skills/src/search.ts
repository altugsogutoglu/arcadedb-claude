import type { Client } from "./agent-memory/index.js";
import { EMBEDDED_TYPES, type EmbeddedType } from "./agent-memory/index.js";
import type { Embedder } from "./embed.js";
import { TEXT_EXPR } from "./embed-runner.js";

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
  via: ("vector" | "text" | "ref")[];
  text: string;
  repo: string | null;
  at: string | null;
  sessionId: string | null;
  rid: string;
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
}

const AT_EXPR: Record<EmbeddedType, string> = {
  Turn: "ts",
  Decision: "decidedAt",
  Insight: "createdAt",
  Question: "askedAt",
  Answer: "answeredAt",
};

/** Properties with a FULL_TEXT index, per type (see schemas/memory.ts). */
const TEXT_INDEXED: Record<EmbeddedType, string[]> = {
  Turn: ["text"],
  Decision: ["summary", "rationale"],
  Insight: ["topic", "text"],
  Question: ["text"],
  Answer: ["text"],
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
         FROM ${type} WHERE embedding IS NOT NULL${repoClause} ORDER BY score DESC LIMIT ${candidates}`);
      (lists["vector"] ??= []).push(...remember(type, rows.map(r => r.rid)));
    }
    if (lucene) {
      for (const prop of TEXT_INDEXED[type]) {
        const rows = await client.query<{ rid: string }>(db, "sql",
          `SELECT @rid AS rid, $score AS score FROM ${type}
           WHERE SEARCH_INDEX(${sqlStr(`${type}[${prop}]`)}, ${sqlStr(lucene)}) = true${repoClause}
           ORDER BY score DESC LIMIT ${candidates}`).catch(() => [] as { rid: string }[]);
        (lists["text"] ??= []).push(...remember(type, rows.map(r => r.rid)));
      }
    }
  }
  if (useText && tokens.length > 0 && types.includes("Turn")) {
    const rows = await client.query<{ rid: string }>(db, "sql",
      `SELECT @rid AS rid FROM (SELECT expand(in('MENTIONS')) FROM Ref WHERE valueLc IN [${tokens.map(sqlStr).join(",")}])
       WHERE @type = 'Turn'${repoClause} LIMIT ${candidates}`).catch(() => [] as { rid: string }[]);
    (lists["ref"] ??= []).push(...remember("Turn", rows.map(r => r.rid)));
  }

  // Vector lists are per type and ordered by score inside each type only; re-rank across types by re-sorting
  // is not possible without scores, so keep insertion order (types in the order requested). Acceptable for RRF.
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

/** @deprecated use hybridSearch; kept for callers that pass an embedder and want vector-only ranking. */
export async function semanticSearch(client: Client, db: string, embed: Embedder, query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
  return hybridSearch(client, db, embed, query, { ...opts, mode: "vector", context: opts.context ?? 0, related: opts.related ?? 0 });
}

async function hydrate(client: Client, db: string, items: { rid: string; type: EmbeddedType; score: number; via: SearchHit["via"] }[]): Promise<SearchHit[]> {
  const byType = new Map<EmbeddedType, typeof items>();
  for (const it of items) (byType.get(it.type) ?? byType.set(it.type, []).get(it.type)!).push(it);
  const out = new Map<string, SearchHit>();
  for (const [type, group] of byType) {
    const rows = await client.query<{ rid: string; body: string; repo?: string; at?: string; sessionId?: string; idx?: number }>(db, "sql",
      `SELECT @rid AS rid, ${TEXT_EXPR[type]} AS body, repo, ${AT_EXPR[type]} AS at, ${type === "Turn" ? "sessionId, idx" : "null AS sessionId, null AS idx"}
       FROM ${type} WHERE @rid IN [${group.map(g => g.rid).join(",")}]`);
    for (const r of rows) {
      const it = group.find(g => g.rid === r.rid)!;
      out.set(r.rid, { type, score: it.score, via: it.via, text: r.body ?? "", repo: r.repo ?? null, at: r.at ?? null, sessionId: r.sessionId ?? null, rid: r.rid, ...(r.idx != null ? { idx: r.idx } : {}) } as SearchHit & { idx?: number });
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
    const meta = [h.type, h.repo, h.at ? h.at.slice(0, 16) : null, h.via.join("+")].filter(Boolean).join(" | ");
    const lines = [`${i + 1}. [${h.score.toFixed(3)}] ${meta}`, `   ${text.replace(/\n/g, "\n   ")}`];
    for (const b of h.context?.before ?? []) lines.push(`   ↑ ${b.role ?? "?"}: ${clip(b.text, 120)}`);
    for (const a of h.context?.after ?? []) lines.push(`   ↓ ${a.role ?? "?"}: ${clip(a.text, 120)}`);
    for (const r of h.related ?? []) lines.push(`   ~ ${r.repo ?? "?"} ${r.at ? r.at.slice(0, 10) : ""}: ${clip(r.text, 120)}`);
    return lines.join("\n");
  }).join("\n");
}
