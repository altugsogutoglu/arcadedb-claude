import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, copyFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Client, applySchemas } from "../src/agent-memory/index.js";
import { createTempDb, env, type TempDb } from "./helpers/temp-db.js";

const require = createRequire(import.meta.url);
const tsxBin = require.resolve("tsx/cli");
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const client = new Client(env);

function run(script: string, args: string[], stdin: string, envOverride: Record<string, string>): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxBin, script, ...args], { env: { ...process.env, ...envOverride }, cwd: join(__dirname, "..") });
    let stdout = "", stderr = "";
    child.stdout.on("data", d => { stdout += d.toString(); });
    child.stderr.on("data", d => { stderr += d.toString(); });
    child.on("close", code => resolve({ stdout, stderr, code: code ?? 0 }));
    child.on("error", reject);
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

let memoryDb: TempDb;
let projectDb: TempDb;
let tmpHome: string;
let originalHome: string | undefined;

beforeAll(async () => {
  memoryDb = await createTempDb("e2e-mem");
  projectDb = await createTempDb("e2e-proj");
  await applySchemas(client, memoryDb.name, ["core", "memory"]);
  await applySchemas(client, projectDb.name, ["core", "code"]);
});
afterAll(async () => { await memoryDb.drop(); await projectDb.drop(); });

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "arcadedb-e2e-"));
  originalHome = process.env["HOME"];
  process.env["HOME"] = tmpHome;
  const cfg = join(tmpHome, ".config", "arcadedb");
  mkdirSync(cfg, { recursive: true });
  if (!originalHome) throw new Error("HOME unset");
  copyFileSync(join(originalHome, ".config", "arcadedb", ".env"), join(cfg, ".env"));
  writeFileSync(join(cfg, "projects.json"), JSON.stringify({
    version: 1, defaultMemoryDb: memoryDb.name,
    projects: { "project-a": { db: projectDb.name, path: "/elsewhere/project-a", stack: [], indexLevel: 2, lastIndexed: null } },
  }));
});
afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  if (originalHome !== undefined) process.env["HOME"] = originalHome;
});

describe("capture end to end", () => {
  it("session-start -> 10 stops -> block with line range -> extract-write live -> node in graph, all logged", async () => {
    const sid = "e2e-session-1";
    const transcript = join(tmpHome, "transcript.jsonl");
    writeFileSync(transcript, "");

    // 1. SessionStart with stdin payload
    const ss = await run("src/session-start.ts", [], JSON.stringify({ session_id: sid, cwd: "/elsewhere/project-a", hook_event_name: "SessionStart", source: "startup" }), { HOME: tmpHome });
    expect(ss.code).toBe(0);
    const statePath = join(tmpHome, ".config", "arcadedb", "sessions", `${sid}.json`);
    expect(existsSync(statePath)).toBe(true);
    const sessionDbId = JSON.parse(readFileSync(statePath, "utf8")).sessionDbId as string;

    // 2. Ten Stop events, transcript grows 5 lines per turn
    let block = "";
    for (let t = 1; t <= 10; t++) {
      writeFileSync(transcript, readFileSync(transcript, "utf8") + Array.from({ length: 5 }, (_, i) => JSON.stringify({ type: i % 2 ? "assistant" : "user", t, i })).join("\n") + "\n");
      const st = await run("src/stop.ts", [], JSON.stringify({ session_id: sid, stop_hook_active: false, transcript_path: transcript }), { HOME: tmpHome, ARCADEDB_EXTRACTOR: "live", CLAUDE_PLUGIN_ROOT: "/plug" });
      expect(st.code).toBe(0);
      if (t < 10) expect(st.stdout).toBe("");
      else block = st.stdout;
    }
    const reason = JSON.parse(block).reason as string;
    expect(reason).toContain("- lines: 1..50");
    expect(reason).toContain("- turn: 10");
    expect(reason).toContain(`- sessionDbId: ${sessionDbId}`);

    // 3. Extractor output -> extract-write live
    const raw = join(tmpHome, "raw.json");
    writeFileSync(raw, JSON.stringify({
      triples: [{
        subject: { label: "Decision", props: { id: "e2e-dec-1", summary: "Use stdin session id", rationale: "env var never set" } },
        verb: "DURING",
        object: { label: "Session", props: { id: sessionDbId } },
        evidence: "we decided to read session_id from hook stdin",
      }],
      unknown_terms: [],
    }));
    const ew = await run("bin/arcadedb-skills.ts", ["extract-write", "--raw", raw, "--session", sessionDbId, "--cc-session", sid, "--turns", "10..10", "--lines", "1..50", "--turn", "10", "--mode", "live"], "", { HOME: tmpHome });
    expect(ew.stderr).toBe("");
    expect(ew.code).toBe(0);
    const summary = JSON.parse(ew.stdout.trim().split("\n").at(-1)!);
    expect(summary.counts.written).toBe(1);
    expect(summary.counts.failed).toBe(0);

    // 4. Node exists in graph
    const rows = await client.query<{ n: number }>(memoryDb.name, "cypher", 'MATCH (d:Decision {id: "e2e-dec-1"}) RETURN count(d) AS n');
    expect(rows[0]?.n).toBe(1);

    // 5. State advanced, next stop is not due
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state.lastExtractedTurnIdx).toBe(10);
    expect(state.lastExtractedLine).toBe(50);
    const st11 = await run("src/stop.ts", [], JSON.stringify({ session_id: sid, stop_hook_active: false, transcript_path: transcript }), { HOME: tmpHome, ARCADEDB_EXTRACTOR: "live" });
    expect(st11.stdout).toBe("");

    // 6. Log has the full story
    const log = readFileSync(join(tmpHome, ".config", "arcadedb", "capture.log"), "utf8");
    const events = log.trim().split("\n").map(l => JSON.parse(l).event);
    expect(events.filter(e => e === "skip")).toHaveLength(10);
    expect(events).toContain("trigger");
    expect(events).toContain("write");
  });
});
