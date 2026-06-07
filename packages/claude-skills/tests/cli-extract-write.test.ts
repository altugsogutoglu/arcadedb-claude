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
});
