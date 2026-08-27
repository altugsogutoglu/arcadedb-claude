import type { Client } from "./agent-memory/index.js";
import { EMBEDDED_TYPES, type EmbeddedType } from "./agent-memory/index.js";
import type { Embedder } from "./embed.js";
import { TEXT_EXPR } from "./embed-runner.js";

export interface SearchHit {
  type: EmbeddedType;
  score: number;
  text: string;
  repo: string | null;
  at: string | null;
  sessionId: string | null;
  rid: string;
}

const AT_EXPR: Record<EmbeddedType, string> = {
  Turn: "ts",
  Decision: "decidedAt",
  Insight: "createdAt",
  Question: "askedAt",
  Answer: "answeredAt",
};

/**
 * Cosine top-K over every embedded type. Brute force via vectorCosineSimilarity;
 * the LSM_VECTOR index exists for when ArcadeDB's planner can use it, the scan
 * is fast enough for tens of thousands of turns.
 */
export async function semanticSearch(
  client: Client,
  db: string,
  embed: Embedder,
  query: string,
  opts: { limit?: number; types?: readonly EmbeddedType[]; repo?: string } = {},
): Promise<SearchHit[]> {
  const limit = opts.limit ?? 10;
  const types = opts.types ?? EMBEDDED_TYPES;
  const [vec] = await embed([query]);
  const literal = `[${vec!.map(v => v.toFixed(6)).join(",")}]`;
  const hits: SearchHit[] = [];
  for (const type of types) {
    const repoClause = opts.repo ? ` AND repo = '${opts.repo.replace(/'/g, "\\'")}'` : "";
    const rows = await client.query<{ rid: string; body: string; repo?: string; at?: string; sessionId?: string; score: number }>(db, "sql",
      `SELECT @rid AS rid, ${TEXT_EXPR[type]} AS body, repo, ${AT_EXPR[type]} AS at, ${type === "Turn" ? "sessionId" : "null"} AS sessionId,
              vectorCosineSimilarity(embedding, ${literal}) AS score
       FROM ${type} WHERE embedding IS NOT NULL${repoClause}
       ORDER BY score DESC LIMIT ${limit}`);
    for (const r of rows) {
      hits.push({ type, score: r.score, text: r.body ?? "", repo: r.repo ?? null, at: r.at ?? null, sessionId: r.sessionId ?? null, rid: r.rid });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

export function formatHits(hits: SearchHit[], maxChars = 400): string {
  if (hits.length === 0) return "no matches (nothing embedded yet, or embeddings still running)";
  return hits.map((h, i) => {
    const text = h.text.length > maxChars ? h.text.slice(0, maxChars) + "..." : h.text;
    const meta = [h.type, h.repo, h.at ? h.at.slice(0, 16) : null].filter(Boolean).join(" | ");
    return `${i + 1}. [${h.score.toFixed(3)}] ${meta}\n   ${text.replace(/\n/g, "\n   ")}`;
  }).join("\n");
}
