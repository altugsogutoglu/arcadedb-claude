import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const tsxBin = require.resolve("tsx/cli");
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLI = join(__dirname, "..", "bin", "arcadedb-skills.ts");

function run(args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise(resolve => {
    const child = spawn("node", [tsxBin, CLI, ...args], { env: process.env });
    let stdout = "";
    child.stdout.on("data", d => { stdout += d.toString(); });
    child.on("close", code => resolve({ stdout, code: code ?? 0 }));
  });
}

describe("arcadedb-skills extractor-prompt", () => {
  it("prints the extractor system prompt with vocabulary", async () => {
    const { stdout, code } = await run(["extractor-prompt"]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/Decision/);
    expect(stdout).toMatch(/Insight/);
    expect(stdout.length).toBeGreaterThan(200);
  });
});
