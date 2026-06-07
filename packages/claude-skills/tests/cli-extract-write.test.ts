import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const tsxBin = require.resolve("tsx/cli");
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLI = join(__dirname, "..", "bin", "arcadedb-skills.ts");

function runCli(args: string[], env: Record<string, string>): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn("node", [tsxBin, CLI, ...args], {
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "arcadedb-cli-ew-"));
  originalHome = process.env["HOME"];
  process.env["HOME"] = tmpHome;
  mkdirSync(join(tmpHome, ".config", "arcadedb"), { recursive: true });
});
afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  if (originalHome !== undefined) process.env["HOME"] = originalHome;
});

describe("arcadedb-skills extract-write (dryrun)", () => {
  it("validates raw JSON and writes exactly one JSONL audit batch", async () => {
    const rawFile = join(tmpHome, "raw.json");
    writeFileSync(rawFile, JSON.stringify({
      triples: [{
        subject: { label: "Concept", props: { name: "capture" } },
        verb: "ABOUT",
        object: { label: "Concept", props: { name: "extractor" } },
        evidence: "the extractor now writes live",
      }],
    }));

    const { code } = await runCli(
      ["extract-write", "--raw", rawFile, "--session", "sess-9", "--cc-session", "cc-9", "--turns", "1..5", "--mode", "dryrun"],
      { HOME: tmpHome },
    );
    expect(code).toBe(0);

    const dryrunDir = join(tmpHome, ".config", "arcadedb", "dryrun");
    expect(existsSync(dryrunDir)).toBe(true);
    const files = readdirSync(dryrunDir).filter((f) => f.endsWith(".jsonl"));
    expect(files).toHaveLength(1);

    const contents = readFileSync(join(dryrunDir, files[0]!), "utf8");
    expect(contents).toContain('"kind":"batch"');
    expect(contents).toContain('"kind":"triple"');
  });

  it("exits 1 when required flags are missing", async () => {
    const rawFile = join(tmpHome, "raw.json");
    writeFileSync(rawFile, JSON.stringify({ triples: [] }));

    const { code } = await runCli(
      ["extract-write", "--raw", rawFile, "--session", "s"],
      { HOME: tmpHome },
    );
    expect(code).toBe(1);
  });

  it("mode=live with no env config exits 0 and reports the error (no crash, no retry storm)", async () => {
    const rawFile = join(tmpHome, "raw-live.json");
    writeFileSync(rawFile, JSON.stringify({
      triples: [{
        subject: { label: "Concept", props: { name: "x" } },
        verb: "ABOUT",
        object: { label: "Concept", props: { name: "y" } },
        evidence: "live error path test",
      }],
    }));

    const { code, stdout } = await runCli(
      ["extract-write", "--raw", rawFile, "--session", "s-live", "--cc-session", "cc", "--turns", "1..2", "--mode", "live"],
      { HOME: tmpHome },
    );
    expect(code).toBe(0);

    const out = JSON.parse(stdout);
    expect(out.ok).toBe(true);
    expect(out.errors.length).toBeGreaterThan(0);
    expect(out.counts.failed).toBe(1);
  });

  it("exits 0 and writes an error file when validation fails", async () => {
    const rawFile = join(tmpHome, "raw.json");
    writeFileSync(rawFile, JSON.stringify({ not_triples: true }));

    const { code, stdout } = await runCli(
      ["extract-write", "--raw", rawFile, "--session", "badsess", "--cc-session", "cc", "--turns", "1..2", "--mode", "dryrun"],
      { HOME: tmpHome },
    );
    expect(code).toBe(0);

    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(false);
    expect(typeof parsed.reason).toBe("string");

    const errorsDir = join(tmpHome, ".config", "arcadedb", "extractor-errors");
    expect(existsSync(errorsDir)).toBe(true);
    expect(readdirSync(errorsDir).length).toBeGreaterThan(0);
  });
});
