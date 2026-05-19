import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
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
  tmpHome = mkdtempSync(join(tmpdir(), "arcadedb-cli-"));
  originalHome = process.env["HOME"];
  process.env["HOME"] = tmpHome;
  mkdirSync(join(tmpHome, ".config", "arcadedb", "sessions"), { recursive: true });
});
afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  if (originalHome !== undefined) process.env["HOME"] = originalHome;
});

describe("arcadedb-skills mark-extracted", () => {
  it("updates lastExtractedTurnIdx in the state file", async () => {
    const sessionId = "abc";
    const stateFile = join(tmpHome, ".config", "arcadedb", "sessions", `${sessionId}.json`);
    writeFileSync(stateFile, JSON.stringify({
      claudeCodeSessionId: sessionId,
      sessionDbId: "u",
      repo: "demo",
      cwd: "/tmp",
      userName: "T",
      startedAt: "2026-05-19T10:00:00.000Z",
      currentTurnIdx: 10,
      lastExtractedTurnIdx: 0,
      lastExtractedAt: "2026-05-19T10:00:00.000Z",
    }));

    const { code } = await runCli(
      ["mark-extracted", "--session", sessionId, "--turn", "10"],
      { HOME: tmpHome },
    );
    expect(code).toBe(0);
    const updated = JSON.parse(readFileSync(stateFile, "utf8"));
    expect(updated.lastExtractedTurnIdx).toBe(10);
    expect(updated.lastExtractedAt).not.toBe("2026-05-19T10:00:00.000Z");
  });

  it("returns non-zero when state file is missing", async () => {
    const { code, stderr } = await runCli(
      ["mark-extracted", "--session", "missing", "--turn", "1"],
      { HOME: tmpHome },
    );
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/no state file/i);
  });

  it("returns non-zero on missing flags", async () => {
    const { code } = await runCli(["mark-extracted", "--session", "x"], { HOME: tmpHome });
    expect(code).not.toBe(0);
  });

  it("returns non-zero on unknown command", async () => {
    const { code, stderr } = await runCli(["frobnicate"], { HOME: tmpHome });
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/unknown command/i);
  });
});
