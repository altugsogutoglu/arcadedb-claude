#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { Client } from "../src/agent-memory/index.js";
import { markExtracted, readSessionState } from "../src/session-state.js";
import { validateExtraction } from "../src/extractor-validator.js";
import { buildVocabSnapshot } from "../src/vocab-snapshot.js";
import { writeDryrunBatch } from "../src/dryrun-writer.js";
import { executeLiveBatch } from "../src/extract-write.js";
import { loadProjects } from "../src/project-map.js";
import { resolveConfig, toClientEnv } from "../src/config.js";
import { resolveMemoryDb } from "../src/memory-db.js";
import { projectsJsonPath, extractorErrorsPath, dryrunPath } from "../src/env-paths.js";
import type { Triple } from "../src/extractor-validator.js";
import { buildExtractorSystemPrompt } from "../src/extractor-prompt.js";
import { logCapture } from "../src/capture-log.js";
import { configShow, configSet, configTest, configForget, configIndex, SET_KEY_NAMES } from "../src/config-cli.js";
import { embedStatus, embedDir, loadEmbedder, spawnEmbedInstall } from "../src/embed.js";
import { embedPending } from "../src/embed-runner.js";
import { hybridSearch, formatHits, type SearchMode } from "../src/search.js";
import { backfillRefs } from "../src/turn-capture.js";
import { queryDecisions, supersedeDecision, reconcileDecisions } from "../src/agent-memory/index.js";
import { runRollup, pendingSessions } from "../src/rollup-runner.js";
import { selectTransport } from "../src/rollup-llm.js";
import { backfillFullText } from "../src/agent-memory/migrations/fulltext.js";
import { EMBEDDED_TYPES, type EmbeddedType } from "../src/agent-memory/index.js";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

function usage(): void {
  console.error("usage: arcadedb-skills <command> [options]");
  console.error("commands:");
  console.error("  mark-extracted --session <id> --turn <n>   update session state after extractor finishes");
  console.error("  extractor-prompt                           print the extractor system prompt");
  console.error("  extract-write --raw <file> --session <sessionDbId> --cc-session <id> --turns <N..M> --mode <live|dryrun> [--lines <A..B>] [--turn <n>] [--repo <name>]");
  console.error(`  config show | set <${SET_KEY_NAMES}> <value> | test | forget <key> [--drop-db] | index [<key>]`);
  console.error("  search <query> [--limit <n>] [--types Turn,Decision,...] [--repo <name>] [--mode hybrid|vector|text] [--context <n>] [--related <n>] [--json]");
  console.error("      ... [--as-of <ISO>] [--include-superseded]   point-in-time view | show decisions with a closed validity window");
  console.error("      ... [--no-graph] [--hops <n>]                 skip / widen the query-time PageRank over refs, sessions, supersession (default on, 2 hops)");
  console.error("  decisions list [--repo <name>] [--all] [--as-of <ISO>] | supersede <newId> <oldId> [--at <ISO>] | reconcile");
  console.error("  rollup run | status | show <sessionDbId>   summarise ended sessions + weekly digests now | pending count | print a summary");
  console.error("  search reindex                             re-index existing rows for full-text search (one-off after upgrade)");
  console.error("  refs backfill | <value>                    link :Ref nodes for old turns | list turns naming a path/symbol/commit/ticket");
  console.error("  embed install | status | run              manage the local embedding runtime");
  console.error("  extract-replay <sessionDbId|audit.jsonl> [--repo <name>]  re-write a session's audited triples into the graph (repairs nodes written without text)");
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);

  if (!cmd) {
    usage();
    return 1;
  }

  if (cmd === "mark-extracted") {
    const session = flag(rest, "session");
    const turnArg = flag(rest, "turn");
    const turn = Number(turnArg);
    if (!session || turnArg === undefined || !Number.isFinite(turn)) {
      console.error("usage: arcadedb-skills mark-extracted --session <id> --turn <n>");
      return 1;
    }
    const updated = markExtracted(session, turn);
    if (updated) {
      console.log(`marked turn ${turn} as extracted for session ${session}`);
      return 0;
    }
    console.error(`no state file for session ${session}`);
    return 1;
  }

  if (cmd === "search" && rest[0] === "reindex") {
    const cfg = resolveConfig();
    const client = new Client(toClientEnv(cfg));
    const db = resolveMemoryDb(cfg, loadProjects(projectsJsonPath()));
    const pairs: [string, string][] = [["Turn", "text"], ["Decision", "summary"], ["Decision", "rationale"], ["Insight", "topic"], ["Insight", "text"], ["Question", "text"], ["Answer", "text"]];
    for (const [type, prop] of pairs) {
      const n = await backfillFullText(client, db, type, prop);
      console.log(`${type}.${prop}: ${n} rows re-indexed`);
    }
    return 0;
  }

  if (cmd === "search") {
    const VALUE_FLAGS = new Set(["--limit", "--types", "--repo", "--mode", "--context", "--related", "--as-of", "--hops"]);
    const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && VALUE_FLAGS.has(rest[i - 1]!)));
    const query = positional.join(" ").trim();
    if (!query) {
      console.error("usage: arcadedb-skills search <query> [--limit <n>] [--types Turn,Decision,...] [--repo <name>] [--mode hybrid|vector|text] [--context <n>] [--related <n>] [--json]");
      return 1;
    }
    const mode = (flag(rest, "mode") ?? "hybrid") as SearchMode;
    const embedReady = embedStatus() === "ready";
    if (mode === "vector" && !embedReady) {
      console.error(`embedding runtime not ready (${embedStatus()}); run: arcadedb-skills embed install`);
      return 2;
    }
    const limit = Number(flag(rest, "limit") ?? 10);
    const typesArg = flag(rest, "types");
    const types = typesArg
      ? typesArg.split(",").map(t => t.trim()).filter((t): t is EmbeddedType => (EMBEDDED_TYPES as readonly string[]).includes(t))
      : undefined;
    const cfg = resolveConfig();
    const client = new Client(toClientEnv(cfg));
    const db = resolveMemoryDb(cfg, loadProjects(projectsJsonPath()));
    const embed = embedReady && mode !== "text" ? await loadEmbedder() : null;
    const num = (name: string, dflt: number): number => { const v = Number(flag(rest, name)); return Number.isFinite(v) ? v : dflt; };
    const hits = await hybridSearch(client, db, embed, query, {
      limit: Number.isFinite(limit) ? limit : 10, types, repo: flag(rest, "repo"), mode,
      context: num("context", 1), related: num("related", 3),
      includeSuperseded: rest.includes("--include-superseded"), asOf: flag(rest, "as-of"),
      graph: !rest.includes("--no-graph"), hops: num("hops", 2),
    });
    if (!embedReady && mode === "hybrid") console.error("note: embedding runtime not ready, text-only results (arcadedb-skills embed install)");
    console.log(rest.includes("--json") ? JSON.stringify(hits, null, 2) : formatHits(hits));
    return 0;
  }

  if (cmd === "decisions") {
    const cfg = resolveConfig();
    const client = new Client(toClientEnv(cfg));
    const db = resolveMemoryDb(cfg, loadProjects(projectsJsonPath()));
    const sub = rest[0];
    if (sub === "supersede") {
      const [, newId, oldId] = rest;
      if (!newId || !oldId) { console.error("usage: arcadedb-skills decisions supersede <newId> <oldId> [--at <ISO>]"); return 1; }
      const ok = await supersedeDecision(client, db, newId, oldId, flag(rest, "at"));
      console.log(ok ? `${oldId} superseded by ${newId}` : "no such decisions (both ids must exist and differ)");
      return ok ? 0 : 1;
    }
    if (sub === "reconcile") {
      console.log(`closed ${await reconcileDecisions(client, db)} decision window(s)`);
      return 0;
    }
    const list = await queryDecisions(client, db, { repo: flag(rest, "repo"), includeSuperseded: rest.includes("--all"), asOf: flag(rest, "as-of") });
    if (rest.includes("--json")) { console.log(JSON.stringify(list, null, 2)); return 0; }
    if (list.length === 0) { console.log("no decisions"); return 0; }
    for (const d of list) {
      const window = d.validTo ? `valid ${String(d.validFrom ?? d.decidedAt).slice(0, 10)} → ${String(d.validTo).slice(0, 10)} (superseded by ${d.supersededBy ?? "?"})` : `since ${String(d.validFrom ?? d.decidedAt).slice(0, 10)}`;
      console.log(`- [${d.repo}] ${d.summary}\n    ${window}  id=${d.id}${d.rationale ? `\n    ${d.rationale.slice(0, 200)}` : ""}`);
    }
    return 0;
  }

  if (cmd === "rollup") {
    const cfg = resolveConfig();
    const client = new Client(toClientEnv(cfg), { timeoutMs: 30_000 });
    const db = resolveMemoryDb(cfg, loadProjects(projectsJsonPath()));
    const sub = rest[0] ?? "status";
    if (sub === "status") {
      const pending = await pendingSessions(client, db);
      const done = await client.query<{ n: number }>(db, "sql", "SELECT count(*) AS n FROM Session WHERE summary IS NOT NULL AND summary <> ''");
      const digests = await client.query<{ n: number }>(db, "sql", "SELECT count(*) AS n FROM Digest");
      const real = pending.filter(x => x.turnCount >= 4).length;
      console.log(`rollup: ${cfg.rollup ? `on (${cfg.rollupModel} via ${cfg.rollupTransport})` : "off"}; ${done[0]?.n ?? 0} sessions summarised, ${digests[0]?.n ?? 0} weekly digests, ${real} pending (${pending.length - real} too short, skipped)`);
      for (const p of pending.filter(x => x.turnCount >= 4)) console.log(`  pending: ${p.id} ${p.repo ?? "?"} ${String(p.startedAt).slice(0, 16)} ${p.turnCount} turns, attempts=${p.attempts ?? 0}`);
      return 0;
    }
    if (sub === "run") {
      if (!cfg.rollup && !rest.includes("--force")) { console.error("rollup is off (ARCADEDB_ROLLUP=on, or pass --force)"); return 1; }
      const stats = await runRollup({ client, db, model: cfg.rollupModel, llm: selectTransport(cfg.rollupTransport) });
      console.log(JSON.stringify({ ...stats, costUsd: Number(stats.costUsd.toFixed(4)) }));
      return stats.failed ? 1 : 0;
    }
    if (sub === "show") {
      const id = rest[1];
      if (!id) { console.error("usage: arcadedb-skills rollup show <sessionDbId|digestId>"); return 1; }
      const s = await client.query<{ title: string; summary: string; repo: string; startedAt: string; summaryModel: string }>(db, "sql", `SELECT title, summary, repo, startedAt, summaryModel FROM Session WHERE id = '${id.replace(/'/g, "")}'`);
      if (s[0]) { console.log(`# ${s[0].title ?? "(untitled)"}\n${s[0].repo} ${String(s[0].startedAt).slice(0, 16)} (${s[0].summaryModel ?? "?"})\n\n${s[0].summary || "(no summary yet)"}`); return 0; }
      const g = await client.query<{ title: string; text: string; week: string; repo: string }>(db, "sql", `SELECT title, text, week, repo FROM Digest WHERE id = '${id.replace(/'/g, "")}'`);
      if (g[0]) { console.log(`# ${g[0].title}\n${g[0].repo} ${g[0].week}\n\n${g[0].text}`); return 0; }
      console.error("no session or digest with that id");
      return 1;
    }
    console.error("usage: arcadedb-skills rollup run | status | show <id>");
    return 1;
  }

  if (cmd === "refs") {
    const cfg = resolveConfig();
    const client = new Client(toClientEnv(cfg));
    const db = resolveMemoryDb(cfg, loadProjects(projectsJsonPath()));
    if (rest[0] === "backfill") {
      const r = await backfillRefs(client, db);
      console.log(`linked ${r.refs} refs on ${r.turns} turns`);
      return 0;
    }
    const value = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1] === "--limit")).join(" ").trim().toLowerCase();
    if (!value) { console.error("usage: arcadedb-skills refs backfill | <path|symbol|commit|ticket> [--limit <n>] [--json]"); return 1; }
    type RefRow = { kind: string; value: string; id: string; repo: string | null; at: string; role: string; text: string };
    const lim = Number(flag(rest, "limit") ?? 20);
    const rows = await client.query<RefRow>(db, "cypher",
      `MATCH (r:Ref)<-[:MENTIONS]-(t:Turn) WHERE r.valueLc = '${value.replace(/'/g, "\\'")}'
       RETURN r.kind AS kind, r.value AS value, t.id AS id, t.repo AS repo, t.ts AS at, t.role AS role, t.text AS text
       ORDER BY t.ts DESC LIMIT ${Number.isFinite(lim) ? lim : 20}`);
    if (rest.includes("--json")) { console.log(JSON.stringify(rows, null, 2)); return 0; }
    if (rows.length === 0) { console.log(`no turns mention "${value}"`); return 0; }
    console.log(`${rows.length} turn(s) mention ${rows[0]!.kind} ${rows[0]!.value}:`);
    for (const r of rows) console.log(`- ${r.repo ?? "?"} ${String(r.at).slice(0, 16)} ${r.role}: ${(r.text ?? "").replace(/\n/g, " ").slice(0, 160)}`);
    return 0;
  }

  if (cmd === "embed") {
    const sub = rest[0];
    if (sub === "status") {
      console.log(`embedding runtime: ${embedStatus()} (${embedDir()})`);
      return 0;
    }
    if (sub === "install") {
      const status = embedStatus();
      if (status === "ready") { console.log("embedding runtime already installed"); return 0; }
      const pid = spawnEmbedInstall();
      console.log(pid ? `installing @xenova/transformers into ${embedDir()} in the background (pid ${pid}); check: arcadedb-skills embed status`
        : status === "installing" ? "install already running" : "could not start npm install (is npm on PATH?)");
      return pid || status === "installing" ? 0 : 1;
    }
    if (sub === "run") {
      if (embedStatus() !== "ready") { console.error(`embedding runtime not ready (${embedStatus()})`); return 2; }
      const cfg = resolveConfig();
      const client = new Client(toClientEnv(cfg), { timeoutMs: 30_000 });
      const db = resolveMemoryDb(cfg, loadProjects(projectsJsonPath()));
      const n = await embedPending(client, db, await loadEmbedder());
      console.log(`embedded ${n} node(s) in ${db}`);
      return 0;
    }
    console.error("usage: arcadedb-skills embed <install|status|run>");
    return 1;
  }

  if (cmd === "extract-replay") {
    const target = rest[0];
    if (!target) {
      console.error("usage: arcadedb-skills extract-replay <sessionDbId|path/to/audit.jsonl>");
      return 1;
    }
    const auditPath = existsSync(target) ? target : dryrunPath(target);
    if (!existsSync(auditPath)) {
      console.error(`no audit file at ${auditPath}`);
      return 1;
    }
    const triples: Triple[] = [];
    let sessionDbId = flag(rest, "session");
    let repo: string | null = flag(rest, "repo") ?? null;
    for (const line of readFileSync(auditPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let entry: { kind?: string; triple?: Triple; sessionDbId?: string; repo?: string | null };
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry.kind === "batch" && entry.sessionDbId && !sessionDbId) sessionDbId = entry.sessionDbId;
      if (entry.kind === "batch" && entry.repo && !repo) repo = entry.repo;
      if (entry.kind === "triple" && entry.triple) triples.push(entry.triple);
    }
    if (!sessionDbId) sessionDbId = target.replace(/^.*\//, "").replace(/\.jsonl$/, "");
    const cfg = resolveConfig();
    const client = new Client(toClientEnv(cfg));
    const db = resolveMemoryDb(cfg, loadProjects(projectsJsonPath()));
    const result = await executeLiveBatch(triples, {
      execute: (d, cypher) => client.execute(d, "cypher", cypher),
      memoryDb: db,
      naturalKeys: buildVocabSnapshot().naturalKeys,
      sessionDbId,
      repo,
    });
    // Text may have changed under an existing embedding: clear it so the runner recomputes.
    let cleared = 0;
    for (const t of triples) {
      for (const node of [t.subject, t.object]) {
        if (!(EMBEDDED_TYPES as readonly string[]).includes(node.label)) continue;
        const id = node.props["id"];
        if (typeof id !== "string") continue;
        await client.execute(db, "cypher", `MATCH (n:${node.label} {id: '${id.replace(/'/g, "\\'")}'}) SET n.embedding = null`);
        cleared += 1;
      }
    }
    let embedded = 0;
    if (cfg.embed && embedStatus() === "ready") embedded = await embedPending(client, db, await loadEmbedder());
    logCapture("replay", { sessionDbId, db, audit: auditPath, ...result, cleared, embedded });
    console.log(JSON.stringify({ sessionDbId, db, triples: triples.length, written: result.written, failed: result.failed, embedded, errors: result.errors.slice(0, 3) }));
    return result.failed ? 1 : 0;
  }

  if (cmd === "extractor-prompt") {
    process.stdout.write(buildExtractorSystemPrompt(buildVocabSnapshot()));
    return 0;
  }

  if (cmd === "extract-write") {
    const rawFile = flag(rest, "raw");
    const sessionDbId = flag(rest, "session");
    const ccSession = flag(rest, "cc-session");
    const turns = flag(rest, "turns");
    const mode = (flag(rest, "mode") ?? "live").toLowerCase();
    if (!rawFile || !sessionDbId || !ccSession || !turns) {
      console.error("usage: arcadedb-skills extract-write --raw <file> --session <sessionDbId> --cc-session <id> --turns <N..M> --mode <live|dryrun>");
      return 1;
    }

    const lines = flag(rest, "lines");
    const turnArg = flag(rest, "turn");
    const turn = turnArg === undefined ? undefined : Number(turnArg);
    const lineEnd = lines ? Number(lines.split("..")[1]) : undefined;

    const markIfRequested = (): void => {
      if (turn !== undefined && Number.isFinite(turn)) {
        markExtracted(ccSession, turn, Number.isFinite(lineEnd as number) ? lineEnd : undefined);
      }
    };

    const raw = readFileSync(rawFile, "utf8");
    const vocab = buildVocabSnapshot();
    const repo = flag(rest, "repo") ?? readSessionState(ccSession)?.repo ?? null;
    const result = validateExtraction(raw, vocab);

    if (!result.ok) {
      const path = extractorErrorsPath(sessionDbId, new Date().toISOString().replace(/[:.]/g, "-"));
      if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `validation failed: ${result.reason}\n\n${raw}`);
      logCapture("validation_failed", { session: ccSession, sessionDbId, reason: result.reason });
      markIfRequested();
      console.log(JSON.stringify({ ok: false, reason: result.reason }));
      return 0;
    }

    writeDryrunBatch({
      sessionDbId,
      claudeCodeSessionId: ccSession,
      repo,
      turnRange: turns,
      valid: result.valid,
      invalid: result.invalid,
      pendingVocab: result.pendingVocab,
      unknownTerms: result.unknownTerms,
    });

    let live = { written: 0, failed: 0, errors: [] as string[] };
    if (mode === "live") {
      try {
        const map = loadProjects(projectsJsonPath());
        const cfg = resolveConfig();
        const client = new Client(toClientEnv(cfg));
        live = await executeLiveBatch(result.valid, {
          execute: (db, cypher) => client.execute(db, "cypher", cypher),
          memoryDb: resolveMemoryDb(cfg, map),
          naturalKeys: vocab.naturalKeys,
          sessionDbId,
          repo,
        });
      } catch (e) {
        live = { written: 0, failed: result.valid.length, errors: [`live write unavailable: ${(e as Error).message}`] };
      }
    }

    const summary = {
      ok: true,
      mode,
      counts: {
        valid: result.valid.length,
        invalid: result.invalid.length,
        pendingVocab: result.pendingVocab.length,
        unknownTerms: result.unknownTerms.length,
        written: live.written,
        failed: live.failed,
      },
      errors: live.errors,
    };

    const liveFailed = mode === "live" && live.failed > 0;
    if (liveFailed) {
      logCapture("write_failed", { session: ccSession, sessionDbId, mode, lines, written: live.written, failed: live.failed, errors: live.errors });
      console.error(`live write failed: ${live.failed} of ${result.valid.length} triples not written\n${live.errors.join("\n")}`);
      console.log(JSON.stringify({ ...summary, ok: false }));
      markIfRequested();
      return 1;
    }

    markIfRequested();
    logCapture("write", { session: ccSession, sessionDbId, mode, lines, written: live.written, failed: live.failed, invalid: result.invalid.length });
    console.log(JSON.stringify(summary));
    return 0;
  }

  if (cmd === "config") {
    const [sub, ...args] = rest;
    const io = { out: (s: string) => console.log(s), err: (s: string) => console.error(s) };
    switch (sub) {
      case "show":
        return configShow(io);
      case "set": {
        const [key, ...valueParts] = args;
        if (!key || valueParts.length === 0) {
          console.error(`usage: arcadedb-skills config set <${SET_KEY_NAMES}> <value>`);
          return 1;
        }
        const code = configSet(key, valueParts.join(" "), io);
        if (code === 0 && (key === "server" || key === "user" || key === "password")) {
          await configTest(io);
        }
        return code;
      }
      case "test":
        return configTest(io);
      case "forget": {
        const key = args.find(a => !a.startsWith("--"));
        if (!key) {
          console.error("usage: arcadedb-skills config forget <key> [--drop-db]");
          return 1;
        }
        return configForget(key, args.includes("--drop-db"), io);
      }
      case "index":
        return configIndex(args[0] ?? null, process.env["PWD"] ?? process.cwd(), io);
      default:
        console.error("usage: arcadedb-skills config <show|set|test|forget|index>");
        return 1;
    }
  }

  console.error(`unknown command: ${cmd}`);
  usage();
  return 1;
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
