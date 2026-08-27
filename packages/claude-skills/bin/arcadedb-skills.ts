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
import { semanticSearch, formatHits } from "../src/search.js";
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
  console.error("  search <query> [--limit <n>] [--types Turn,Decision,...] [--repo <name>] [--json]   semantic search over captured memory");
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

  if (cmd === "search") {
    const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1]!.startsWith("--") && rest[i - 1] !== "--json"));
    const query = positional.join(" ").trim();
    if (!query) {
      console.error("usage: arcadedb-skills search <query> [--limit <n>] [--types Turn,Decision,...] [--repo <name>] [--json]");
      return 1;
    }
    if (embedStatus() !== "ready") {
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
    const embed = await loadEmbedder();
    const hits = await semanticSearch(client, db, embed, query, { limit: Number.isFinite(limit) ? limit : 10, types, repo: flag(rest, "repo") });
    console.log(rest.includes("--json") ? JSON.stringify(hits, null, 2) : formatHits(hits));
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
