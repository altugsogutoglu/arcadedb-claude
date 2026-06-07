#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { Client, loadEnv } from "arcadedb-agent-memory";
import { markExtracted } from "../src/session-state.js";
import { validateExtraction } from "../src/extractor-validator.js";
import { buildVocabSnapshot } from "../src/vocab-snapshot.js";
import { writeDryrunBatch } from "../src/dryrun-writer.js";
import { executeLiveBatch } from "../src/extract-write.js";
import { loadProjects } from "../src/project-map.js";
import { projectsJsonPath, extractorErrorsPath } from "../src/env-paths.js";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

function usage(): void {
  console.error("usage: arcadedb-skills <command> [options]");
  console.error("commands:");
  console.error("  mark-extracted --session <id> --turn <n>   update session state after extractor finishes");
  console.error("  extract-write --raw <file> --session <sessionDbId> --cc-session <id> --turns <N..M> --mode <live|dryrun>");
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

    const raw = readFileSync(rawFile, "utf8");
    const vocab = buildVocabSnapshot();
    const result = validateExtraction(raw, vocab);

    if (!result.ok) {
      const path = extractorErrorsPath(sessionDbId, new Date().toISOString().replace(/[:.]/g, "-"));
      if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `validation failed: ${result.reason}\n\n${raw}`);
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
        const client = new Client(loadEnv());
        live = await executeLiveBatch(result.valid, {
          execute: (db, cypher) => client.execute(db, "cypher", cypher),
          memoryDb: map.defaultMemoryDb,
          naturalKeys: vocab.naturalKeys,
          sessionDbId,
        });
      } catch (e) {
        live = { written: 0, failed: result.valid.length, errors: [`live write unavailable: ${(e as Error).message}`] };
      }
    }

    console.log(JSON.stringify({
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
    }));
    return 0;
  }

  console.error(`unknown command: ${cmd}`);
  usage();
  return 1;
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
