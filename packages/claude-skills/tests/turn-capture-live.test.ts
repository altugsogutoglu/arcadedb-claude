import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Client, applySchemas, startSession } from "../src/agent-memory/index.js";
import { createTempDb, env, type TempDb } from "./helpers/temp-db.js";
import { loadEmbedder } from "../src/embed.js";
import { embedPending } from "../src/embed-runner.js";
import { semanticSearch, hybridSearch } from "../src/search.js";

const tsxBin = createRequire(import.meta.url).resolve("tsx/cli");
const client = new Client(env);
/** A pre-installed transformers.js runtime to link in; without it the embedding half is skipped, not failed. */
const RUNTIME = process.env["ARCADEDB_TEST_EMBED_DIR"];

function run(script: string, stdin: string, envOverride: Record<string, string>): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxBin, script], { env: { ...process.env, ...envOverride }, cwd: join(__dirname, "..") });
    let stdout = "";
    child.stdout.on("data", d => { stdout += d; });
    child.on("close", code => resolve({ stdout, code: code ?? 0 }));
    child.on("error", reject);
    child.stdin.end(stdin);
  });
}

const user = (text: string, i: number) => JSON.stringify({ type: "user", timestamp: `2026-08-27T10:00:0${i}.000Z`, message: { role: "user", content: text } });
const assistant = (text: string, i: number) => JSON.stringify({ type: "assistant", timestamp: `2026-08-27T10:00:0${i}.500Z`, message: { role: "assistant", content: [{ type: "text", text }] } });

let db: TempDb;
let home: string;
let sessionDbId: string;

beforeAll(async () => {
  db = await createTempDb("turns");
  await applySchemas(client, db.name, ["core", "memory"]);
  home = mkdtempSync(join(tmpdir(), "arcadedb-turns-"));
  const cfgDir = join(home, ".config", "arcadedb");
  mkdirSync(join(cfgDir, "sessions"), { recursive: true });
  writeFileSync(join(cfgDir, ".env"), `ARCADEDB_HTTP_URI=${env.httpUri}\nARCADEDB_USERNAME=${env.username}\nARCADEDB_ROOT_PASSWORD=${env.password}\nARCADEDB_MEMORY_DB=${db.name}\n`);
  writeFileSync(join(cfgDir, "projects.json"), JSON.stringify({ projects: {} }));
  if (RUNTIME && existsSync(join(RUNTIME, "node_modules"))) {
    mkdirSync(join(cfgDir, "embed"), { recursive: true });
    writeFileSync(join(cfgDir, "embed", "package.json"), JSON.stringify({ name: "arcadedb-embed", private: true }));
    symlinkSync(join(RUNTIME, "node_modules"), join(cfgDir, "embed", "node_modules"));
    if (existsSync(join(RUNTIME, "models"))) symlinkSync(join(RUNTIME, "models"), join(cfgDir, "embed", "models"));
  }
  sessionDbId = await startSession(client, db.name, { repo: "demo" });
  writeFileSync(join(cfgDir, "sessions", "cc-1.json"), JSON.stringify({
    claudeCodeSessionId: "cc-1", sessionDbId, repo: "demo", cwd: "/x", userName: "t",
    startedAt: "2026-08-27T09:00:00.000Z", currentTurnIdx: 0, lastExtractedTurnIdx: 0, lastExtractedAt: "2026-08-27T09:00:00.000Z",
    currentLine: 0, lastExtractedLine: 0, lastCapturedLine: 0, extractInFlightSince: null,
  }));
});

afterAll(async () => {
  await db.drop();
  rmSync(home, { recursive: true, force: true });
});

describe("raw turn capture (live)", () => {
  it("Stop hook writes every prompt/answer as :Turn DURING the session, without an LLM, and is idempotent", async () => {
    const transcript = join(home, "t.jsonl");
    writeFileSync(transcript, [
      user("how is lease pricing calculated for long rentals?", 1),
      assistant("Rental cost logic lives in PricingService; long contracts get a tiered discount.", 2),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: {} }] } }),
      user("what colour is the office cat", 3),
      assistant("Fixed in commit ab12cd3, see app/Services/PricingService.php and BACKLOG:7.", 4),
    ].join("\n") + "\n");
    const stdin = JSON.stringify({ session_id: "cc-1", stop_hook_active: false, transcript_path: transcript });
    const first = await run("src/stop.ts", stdin, { HOME: home, ARCADEDB_EMBED: "off" });
    expect(first.code).toBe(0);
    expect(first.stdout).toBe("");

    const rows = await client.query<{ idx: number; role: string; text: string }>(db.name, "sql",
      "SELECT idx, role, text FROM Turn ORDER BY idx");
    expect(rows.map(r => [r.idx, r.role])).toEqual([[1, "user"], [2, "assistant"], [4, "user"], [5, "assistant"]]);
    const linked = await client.query<{ n: number }>(db.name, "cypher",
      `MATCH (t:Turn)-[:DURING]->(s:Session {id: '${sessionDbId}'}) RETURN count(t) AS n`);
    expect(linked[0]!.n).toBe(4);

    // Zero-LLM ref linking: the last answer names a symbol, a path, a commit and a ticket.
    const refs = await client.query<{ id: string }>(db.name, "cypher",
      `MATCH (t:Turn {idx: 5})-[:MENTIONS]->(r:Ref) RETURN r.id AS id ORDER BY id`);
    expect(refs.map(r => r.id)).toEqual(["commit:ab12cd3", "path:app/services/pricingservice.php", "symbol:pricingservice", "ticket:backlog:7"]);

    const state = JSON.parse(readFileSync(join(home, ".config", "arcadedb", "sessions", "cc-1.json"), "utf8"));
    expect(state.lastCapturedLine).toBe(5);
    const log = readFileSync(join(home, ".config", "arcadedb", "capture.log"), "utf8");
    expect(log).toContain('"event":"turns_captured"');
    expect(log).toContain('"reason":"extractor_off"');

    // Same transcript again: nothing new to capture, no duplicates.
    await run("src/stop.ts", stdin, { HOME: home, ARCADEDB_EMBED: "off" });
    const again = await client.query<{ n: number }>(db.name, "sql", "SELECT count(*) AS n FROM Turn");
    expect(again[0]!.n).toBe(4);
  });

  it("full-text search finds an exact identifier without embeddings and expands the hit with context and related turns", async () => {
    const hits = await hybridSearch(client, db.name, null, "ab12cd3", { limit: 3, types: ["Turn"], context: 1, related: 3 });
    expect(hits[0]!.via.slice(0, 2)).toEqual(["text", "ref"]);
    // The other turns of the session arrive through the graph walk only.
    for (const h of hits.slice(1)) expect(h.via).toEqual(["graph"]);
    expect(hits[0]!.text).toContain("ab12cd3");
    expect(hits[0]!.context!.before.map(b => b.text)).toEqual(["what colour is the office cat"]);
    expect(hits[0]!.context!.after).toEqual([]);
    // Same session only so far: nothing related from elsewhere.
    expect(hits[0]!.related).toEqual([]);

    // A second session naming the same symbol becomes a related turn (cross-session / cross-repo link).
    const other = await startSession(client, db.name, { repo: "other-repo" });
    const { writeTurns } = await import("../src/turn-capture.js");
    await writeTurns(client, db.name, { sessionDbId: other, repo: "other-repo", turns: [{ line: 1, role: "user", text: "does PricingService round up?", ts: "2026-08-27T11:00:00.000Z" }] });
    const again = await hybridSearch(client, db.name, null, "PricingService path", { limit: 5, types: ["Turn"], repo: "demo", context: 0, related: 3 });
    const withRelated = again.find(h => h.text.includes("PricingService.php"))!;
    expect(withRelated.related!.map(r => r.repo)).toEqual(["other-repo"]);
    // Quoted path token survives the Lucene lexer.
    const byPath = await hybridSearch(client, db.name, null, "app/Services/PricingService.php", { limit: 3, mode: "text", context: 0, related: 0 });
    expect(byPath[0]!.text).toContain("PricingService.php");
  });

  it.skipIf(!RUNTIME)("embed-runner fills embeddings locally and semantic search ranks a paraphrase above noise", async () => {
    const cfgDir = join(home, ".config", "arcadedb");
    const embed = await loadEmbedder(join(cfgDir, "embed"));
    const n = await embedPending(client, db.name, embed);
    expect(n).toBe(5);
    expect(await embedPending(client, db.name, embed)).toBe(0);

    const dims = await client.query<{ d: number }>(db.name, "sql", "SELECT embedding.size() AS d FROM Turn LIMIT 1");
    expect(dims[0]!.d).toBe(384);

    const hits = await semanticSearch(client, db.name, embed, "rental cost logic", { limit: 3, types: ["Turn"] });
    expect(hits[0]!.text).toMatch(/pricing|Rental cost/i);
    expect(hits.find(h => /office cat/.test(h.text))!.score).toBeLessThan(hits[0]!.score);
  });
});
