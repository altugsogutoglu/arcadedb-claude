import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const tsxBin = require.resolve("tsx/cli");
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLI = join(__dirname, "..", "bin", "arcadedb-memory.ts");

function runCli(args: string[], stdin: string, env: Record<string, string>): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn("node", [tsxBin, CLI, ...args], {
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.stdin.on("error", () => {});
    child.stdin.write(stdin);
    child.stdin.end();
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "arcadedb-review-"));
  originalHome = process.env["HOME"];
  process.env["HOME"] = tmpHome;
});
afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  if (originalHome !== undefined) process.env["HOME"] = originalHome;
});

function writeDryrunFile(session: string, lines: object[]): void {
  const dir = join(tmpHome, ".config", "arcadedb", "dryrun");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${session}.jsonl`), lines.map((o) => JSON.stringify(o)).join("\n") + "\n");
}

describe("arcadedb-memory dryrun-review", () => {
  it("appends accepted triples to dryrun-accepted.jsonl", async () => {
    writeDryrunFile("s1", [
      { kind: "batch", turnRange: "1..2", counts: { valid: 1 } },
      { kind: "triple", triple: { subject:{label:"Person",props:{name:"A"}}, verb:"DECIDED_ON", object:{label:"Concept",props:{name:"X"}}, evidence:"e" }, cypher: "MERGE..." },
    ]);

    const { code, stdout } = await runCli(["dryrun-review", "s1"], "a\n", { HOME: tmpHome });
    expect(code).toBe(0);
    expect(stdout).toMatch(/1 accepted/);

    const acceptedPath = join(tmpHome, ".config", "arcadedb", "dryrun-accepted.jsonl");
    expect(existsSync(acceptedPath)).toBe(true);
    const accepted = readFileSync(acceptedPath, "utf8");
    expect(accepted).toMatch(/DECIDED_ON/);
    expect(accepted).toMatch(/"session":"s1"/);
  });

  it("does not append on reject", async () => {
    writeDryrunFile("s2", [
      { kind: "batch", counts: { valid: 1 } },
      { kind: "triple", triple: { subject:{label:"Person",props:{name:"A"}}, verb:"DECIDED_ON", object:{label:"Concept",props:{name:"X"}}, evidence:"e" }, cypher: "MERGE..." },
    ]);
    const { code, stdout } = await runCli(["dryrun-review", "s2"], "r\n", { HOME: tmpHome });
    expect(code).toBe(0);
    expect(stdout).toMatch(/1 rejected/);
    const acceptedPath = join(tmpHome, ".config", "arcadedb", "dryrun-accepted.jsonl");
    expect(existsSync(acceptedPath)).toBe(false);
  });

  it("exits 1 when dry-run file missing", async () => {
    const { code, stderr } = await runCli(["dryrun-review", "ghost"], "", { HOME: tmpHome });
    expect(code).toBe(1);
    expect(stderr).toMatch(/no dry-run file/i);
  });

  it("exits 1 when session arg missing", async () => {
    const { code, stderr } = await runCli(["dryrun-review"], "", { HOME: tmpHome });
    expect(code).toBe(1);
    expect(stderr).toMatch(/usage/i);
  });

  it("quits early on q", async () => {
    writeDryrunFile("s5", [
      { kind: "batch" },
      { kind: "triple", triple: { subject:{label:"Person",props:{name:"A"}}, verb:"DECIDED_ON", object:{label:"Concept",props:{name:"X"}}, evidence:"e1" } },
      { kind: "triple", triple: { subject:{label:"Person",props:{name:"B"}}, verb:"DECIDED_ON", object:{label:"Concept",props:{name:"Y"}}, evidence:"e2" } },
    ]);
    const { code, stdout } = await runCli(["dryrun-review", "s5"], "q\n", { HOME: tmpHome });
    expect(code).toBe(0);
    expect(stdout).toMatch(/quit/);
  });
});
