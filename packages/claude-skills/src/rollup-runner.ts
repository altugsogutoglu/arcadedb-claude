#!/usr/bin/env node
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Client, supersedeDecision } from "./agent-memory/index.js";
import { configDir } from "./env-paths.js";
import { resolveConfig, toClientEnv } from "./config.js";
import { acquireLock } from "./lock.js";
import { logCapture } from "./capture-log.js";
import { hybridSearch } from "./search.js";
import { spawnEmbedRunner } from "./embed-spawn.js";
import { isEmbedInstalled } from "./embed.js";
import { selectTransport, type LlmTransport } from "./rollup-llm.js";
import {
  buildSessionPrompt, buildDigestPrompt, parseSessionRollup, parseDigest, isoWeek, digestId,
  SESSION_SYSTEM_PROMPT, DIGEST_SYSTEM_PROMPT, MIN_TURNS_FOR_ROLLUP, MAX_ROLLUP_ATTEMPTS,
  type CandidateDecision, type RollupTurn,
} from "./rollup.js";

/** A session with no SessionEnd for this long is treated as abandoned and closed. */
const ABANDON_AFTER_MS = 6 * 60 * 60 * 1000;
const CANDIDATE_DECISIONS = 8;

export interface RollupStats {
  closed: number;
  summarized: number;
  skipped: number;
  failed: number;
  decisions: number;
  superseded: number;
  digests: number;
  costUsd: number;
}

export interface RollupDeps {
  client: Client;
  db: string;
  model: string;
  llm: LlmTransport;
  now?: () => Date;
}

function sqlStr(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function cypherStr(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function iso(d: Date): string {
  return d.toISOString();
}

/** Close sessions that never got a SessionEnd (crash, kill -9, laptop lid). */
export async function closeAbandonedSessions(deps: RollupDeps): Promise<number> {
  const now = (deps.now ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - ABANDON_AFTER_MS);
  const rows = await deps.client.query<{ id: string }>(deps.db, "sql",
    `SELECT id FROM Session WHERE endedAt IS NULL AND startedAt < ${sqlStr(iso(cutoff))}`);
  let closed = 0;
  for (const r of rows) {
    // Separate query on purpose: correlated subqueries return nested rows on some ArcadeDB versions.
    const last = await deps.client.query<{ last: string | null }>(deps.db, "sql",
      `SELECT max(ts) AS last FROM Turn WHERE sessionId = ${sqlStr(r.id)}`);
    const endedAt = typeof last[0]?.last === "string" && last[0].last ? last[0].last.replace(" ", "T") : iso(cutoff);
    await deps.client.execute(deps.db, "sql", `UPDATE Session SET endedAt = ${sqlStr(endedAt)} WHERE id = ${sqlStr(r.id)}`);
    closed += 1;
  }
  return closed;
}

interface PendingSession {
  id: string;
  repo: string | null;
  startedAt: string;
  endedAt: string | null;
  attempts: number | null;
  turnCount: number;
}

/** Sessions per run that get a model call; the rest wait for the next SessionEnd/SessionStart. */
const LLM_BATCH = 20;

/**
 * Ended sessions without a summary, with their turn count. Sessions too short for a model call are
 * marked done right here so they never take a slot in the LLM batch (pre-capture sessions have no turns at all).
 */
export async function pendingSessions(client: Client, db: string): Promise<PendingSession[]> {
  const rows = await client.query<Omit<PendingSession, "turnCount">>(db, "sql",
    `SELECT id, repo, startedAt, endedAt, rollupAttempts AS attempts FROM Session
     WHERE endedAt IS NOT NULL AND summary IS NULL AND (rollupAttempts IS NULL OR rollupAttempts < ${MAX_ROLLUP_ATTEMPTS})
     ORDER BY endedAt ASC`);
  if (rows.length === 0) return [];
  const counts = new Map<string, number>();
  for (const c of await client.query<{ sessionId: string; n: number }>(db, "sql", "SELECT sessionId, count(*) AS n FROM Turn GROUP BY sessionId")) {
    counts.set(c.sessionId, Number(c.n));
  }
  const out: PendingSession[] = [];
  let budget = LLM_BATCH;
  for (const r of rows) {
    const n = counts.get(r.id) ?? 0;
    if (n < MIN_TURNS_FOR_ROLLUP) {
      await client.execute(db, "sql", `UPDATE Session SET summary = '', turnCount = ${n} WHERE id = ${sqlStr(r.id)}`);
      out.push({ ...r, turnCount: n });
      continue;
    }
    if (budget > 0) { out.push({ ...r, turnCount: n }); budget -= 1; }
  }
  return out;
}

/** Summarise one ended session, record its new decisions and close superseded ones. */
export async function rollupSession(deps: RollupDeps, session: PendingSession, stats: RollupStats): Promise<void> {
  const { client, db } = deps;
  if (session.turnCount < MIN_TURNS_FOR_ROLLUP) {
    // Already marked done by pendingSessions; not worth a model call.
    stats.skipped += 1;
    return;
  }
  const turns = await client.query<RollupTurn>(db, "sql",
    `SELECT idx, role, text FROM Turn WHERE sessionId = ${sqlStr(session.id)} ORDER BY idx ASC`);
  const repo = session.repo ?? "unknown";
  const recorded = await client.query<CandidateDecision>(db, "cypher",
    `MATCH (d:Decision)-[:DURING]->(s:Session {id: ${cypherStr(session.id)}})
     RETURN d.id AS id, d.summary AS summary, d.rationale AS rationale, d.decidedAt AS decidedAt`).catch(() => []);
  const candidates = await priorDecisionCandidates(deps, repo, session, turns, recorded.map(r => r.id));

  await client.execute(db, "sql", `UPDATE Session SET rollupAttempts = ${(session.attempts ?? 0) + 1} WHERE id = ${sqlStr(session.id)}`);
  const prompt = buildSessionPrompt({ repo, startedAt: String(session.startedAt), endedAt: session.endedAt ? String(session.endedAt) : null, turns, recorded, candidates });
  const res = await deps.llm({ system: SESSION_SYSTEM_PROMPT, prompt, model: deps.model, maxTokens: 2048 });
  stats.costUsd += res.costUsd ?? 0;
  const parsed = parseSessionRollup(res.text);
  if (!parsed) {
    stats.failed += 1;
    logCapture("rollup_invalid", { session: session.id, sample: res.text.slice(0, 200) });
    return;
  }

  const now = iso((deps.now ?? (() => new Date()))());
  await client.execute(db, "cypher",
    `MATCH (s:Session {id: ${cypherStr(session.id)}})
     SET s.summary = ${cypherStr(parsed.summary)}, s.title = ${cypherStr(parsed.title)},
         s.summarizedAt = datetime(${cypherStr(now)}), s.summaryModel = ${cypherStr(deps.model)},
         s.turnCount = ${turns.length}, s.embedding = null`);
  stats.summarized += 1;

  const known = new Set(candidates.map(c => c.id));
  const validFrom = String(session.startedAt).replace(" ", "T");
  for (const d of parsed.decisions) {
    const id = randomUUID();
    await client.execute(db, "cypher",
      `MATCH (s:Session {id: ${cypherStr(session.id)}})
       CREATE (d:Decision {id: ${cypherStr(id)}, summary: ${cypherStr(d.summary)}, rationale: ${cypherStr(d.rationale)},
                           decidedAt: datetime(${cypherStr(now)}), validFrom: datetime(${cypherStr(validFrom)}), repo: ${cypherStr(repo)}})
       CREATE (d)-[:DURING]->(s)`);
    stats.decisions += 1;
    for (const old of d.supersedes) {
      if (!known.has(old)) continue; // the model may only close windows it was shown
      if (await supersedeDecision(client, db, id, old, validFrom)) stats.superseded += 1;
    }
  }
}

/** Prior decisions of the repo the session might have replaced: found by the session's own text and refs. */
async function priorDecisionCandidates(deps: RollupDeps, repo: string, session: PendingSession, turns: RollupTurn[], exclude: string[]): Promise<CandidateDecision[]> {
  const probe = turns.filter(t => t.role === "user").map(t => t.text.slice(0, 200)).join(" ").slice(0, 1500);
  const out = new Map<string, CandidateDecision>();
  const add = async (rows: CandidateDecision[]): Promise<void> => {
    for (const r of rows) if (!exclude.includes(r.id) && !out.has(r.id)) out.set(r.id, r);
  };
  if (probe.trim()) {
    const hits = await hybridSearch(deps.client, deps.db, null, probe, { limit: CANDIDATE_DECISIONS, types: ["Decision"], repo, mode: "text", context: 0, related: 0 }).catch(() => []);
    if (hits.length) {
      const rows = await deps.client.query<CandidateDecision>(deps.db, "sql",
        `SELECT id, summary, rationale, coalesce(validFrom, decidedAt) AS decidedAt FROM Decision
         WHERE @rid IN [${hits.map(h => h.rid).join(",")}] AND validTo IS NULL AND coalesce(validFrom, decidedAt) < ${sqlStr(String(session.startedAt).replace(" ", "T"))}`).catch(() => []);
      await add(rows);
    }
  }
  if (out.size < CANDIDATE_DECISIONS) {
    const recent = await deps.client.query<CandidateDecision>(deps.db, "sql",
      `SELECT id, summary, rationale, coalesce(validFrom, decidedAt) AS decidedAt FROM Decision WHERE repo = ${sqlStr(repo)} AND validTo IS NULL
       AND coalesce(validFrom, decidedAt) < ${sqlStr(String(session.startedAt).replace(" ", "T"))} ORDER BY validFrom DESC, decidedAt DESC LIMIT ${CANDIDATE_DECISIONS}`).catch(() => []);
    await add(recent);
  }
  return [...out.values()].slice(0, CANDIDATE_DECISIONS);
}

/** One digest per repo per completed ISO week that has summarised sessions and no fresh digest. */
export async function rollupDigests(deps: RollupDeps, stats: RollupStats): Promise<void> {
  const { client, db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const sessions = await client.query<{ id: string; repo: string; startedAt: string; title: string | null; summary: string; summarizedAt: string }>(db, "sql",
    `SELECT id, repo, startedAt, title, summary, summarizedAt FROM Session
     WHERE summary IS NOT NULL AND summary <> '' AND repo IS NOT NULL ORDER BY startedAt ASC`);
  const buckets = new Map<string, { repo: string; week: ReturnType<typeof isoWeek>; sessions: typeof sessions }>();
  for (const s of sessions) {
    const started = new Date(String(s.startedAt).replace(" ", "T"));
    const week = isoWeek(started);
    if (week.end.getTime() > now.getTime()) continue; // week still running
    const key = digestId(s.repo, week.key);
    const b = buckets.get(key) ?? { repo: s.repo, week, sessions: [] };
    b.sessions.push(s);
    buckets.set(key, b);
  }
  for (const [id, b] of buckets) {
    const existing = await client.query<{ createdAt: string }>(db, "sql", `SELECT createdAt FROM Digest WHERE id = ${sqlStr(id)}`);
    const newest = b.sessions.map(s => String(s.summarizedAt)).sort().pop()!;
    if (existing.length && String(existing[0]!.createdAt) >= newest) continue;

    const decisions = await client.query<CandidateDecision>(db, "sql",
      `SELECT id, summary, rationale, coalesce(validFrom, decidedAt) AS decidedAt FROM Decision WHERE repo = ${sqlStr(b.repo)}
       AND coalesce(validFrom, decidedAt) >= ${sqlStr(iso(b.week.start))} AND coalesce(validFrom, decidedAt) < ${sqlStr(iso(b.week.end))} ORDER BY decidedAt ASC`).catch(() => []);
    const prompt = buildDigestPrompt({
      repo: b.repo, week: b.week.key, periodStart: iso(b.week.start), periodEnd: iso(b.week.end),
      sessions: b.sessions.map(s => ({ id: s.id, startedAt: String(s.startedAt), title: s.title, summary: s.summary })),
      decisions,
    });
    const res = await deps.llm({ system: DIGEST_SYSTEM_PROMPT, prompt, model: deps.model, maxTokens: 3000 });
    stats.costUsd += res.costUsd ?? 0;
    const parsed = parseDigest(res.text);
    if (!parsed) {
      stats.failed += 1;
      logCapture("digest_invalid", { digest: id, sample: res.text.slice(0, 200) });
      continue;
    }
    const createdAt = iso((deps.now ?? (() => new Date()))());
    await client.execute(db, "cypher",
      `MERGE (g:Digest {id: ${cypherStr(id)}})
       SET g.repo = ${cypherStr(b.repo)}, g.week = ${cypherStr(b.week.key)},
           g.periodStart = datetime(${cypherStr(iso(b.week.start))}), g.periodEnd = datetime(${cypherStr(iso(b.week.end))}),
           g.title = ${cypherStr(parsed.title)}, g.text = ${cypherStr(parsed.text)}, g.sessionCount = ${b.sessions.length},
           g.createdAt = datetime(${cypherStr(createdAt)}), g.model = ${cypherStr(deps.model)}, g.embedding = null`);
    for (const s of b.sessions) {
      await client.execute(db, "cypher",
        `MATCH (g:Digest {id: ${cypherStr(id)}}), (s:Session {id: ${cypherStr(s.id)}}) MERGE (g)-[:COVERS]->(s)`);
    }
    stats.digests += 1;
  }
}

export async function runRollup(deps: RollupDeps): Promise<RollupStats> {
  const stats: RollupStats = { closed: 0, summarized: 0, skipped: 0, failed: 0, decisions: 0, superseded: 0, digests: 0, costUsd: 0 };
  stats.closed = await closeAbandonedSessions(deps);
  for (const s of await pendingSessions(deps.client, deps.db)) {
    try {
      await rollupSession(deps, s, stats);
    } catch (err) {
      stats.failed += 1;
      logCapture("rollup_failed", { session: s.id, error: (err as Error)?.message ?? String(err) });
    }
  }
  try {
    await rollupDigests(deps, stats);
  } catch (err) {
    stats.failed += 1;
    logCapture("digest_failed", { error: (err as Error)?.message ?? String(err) });
  }
  return stats;
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

async function main(): Promise<void> {
  const db = flag(process.argv, "db");
  if (!db) {
    console.error("usage: rollup-runner --db <name>");
    process.exit(2);
  }
  const cfg = resolveConfig();
  if (!cfg.rollup) {
    logCapture("rollup_skip", { reason: "off", db });
    return;
  }
  const lock = join(configDir(), "rollup.lock");
  if (!acquireLock(lock)) {
    logCapture("rollup_skip", { reason: "locked", db });
    return;
  }
  const started = Date.now();
  try {
    const client = new Client(toClientEnv(cfg), { timeoutMs: 30_000 });
    const stats = await runRollup({ client, db, model: cfg.rollupModel, llm: selectTransport(cfg.rollupTransport) });
    if (stats.summarized || stats.digests || stats.failed || stats.closed) {
      logCapture("rollup_done", { db, ...stats, costUsd: Number(stats.costUsd.toFixed(4)), ms: Date.now() - started });
    }
    if ((stats.summarized || stats.digests) && cfg.embed && isEmbedInstalled()) spawnEmbedRunner({ db });
  } catch (err) {
    logCapture("rollup_failed", { db, error: (err as Error)?.message ?? String(err) });
    process.exitCode = 1;
  } finally {
    try { unlinkSync(lock); } catch { /* already gone */ }
  }
}

const isEntry = process.argv[1] !== undefined && /rollup-runner\.(?:js|ts)$/.test(process.argv[1]);
if (isEntry) {
  main().catch(err => {
    logCapture("rollup_failed", { error: (err as Error)?.message ?? String(err) });
    process.exit(1);
  });
}
