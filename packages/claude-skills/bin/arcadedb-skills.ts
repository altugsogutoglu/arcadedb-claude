#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { Client } from "../src/agent-memory/index.js";
import { markExtracted } from "../src/session-state.js";
import { validateExtraction } from "../src/extractor-validator.js";
import { buildVocabSnapshot } from "../src/vocab-snapshot.js";
import { writeDryrunBatch } from "../src/dryrun-writer.js";
import { executeLiveBatch } from "../src/extract-write.js";
import { loadProjects } from "../src/project-map.js";
import { resolveConfig, toClientEnv } from "../src/config.js";
import { resolveMemoryDb } from "../src/memory-db.js";
import { projectsJsonPath, extractorErrorsPath } from "../src/env-paths.js";
import { buildExtractorSystemPrompt } from "../src/extractor-prompt.js";
import { logCapture } from "../src/capture-log.js";
import { configShow, configSet, configTest, configForget, configIndex } from "../src/config-cli.js";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

function usage(): void {
  console.error("usage: arcadedb-skills <command> [options]");
  console.error("commands:");
  console.error("  mark-extracted --session <id> --turn <n>   update session state after extractor finishes");
  console.error("  extractor-prompt                           print the extractor system prompt");
  console.error("  extract-write --raw <file> --session <sessionDbId> --cc-session <id> --turns <N..M> --mode <live|dryrun> [--lines <A..B>] [--turn <n>]");
  console.error("  config show | set <server|user|password|memory-db|auto-index> <value> | test | forget <key> [--drop-db] | index [<key>]");
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
          console.error("usage: arcadedb-skills config set <server|user|password|memory-db|auto-index> <value>");
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
