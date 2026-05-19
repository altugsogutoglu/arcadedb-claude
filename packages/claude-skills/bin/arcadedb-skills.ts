#!/usr/bin/env node
import { markExtracted } from "../src/session-state.js";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

function usage(): void {
  console.error("usage: arcadedb-skills <command> [options]");
  console.error("commands:");
  console.error("  mark-extracted --session <id> --turn <n>   update session state after extractor finishes");
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

  console.error(`unknown command: ${cmd}`);
  usage();
  return 1;
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
