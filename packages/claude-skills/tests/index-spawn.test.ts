import { describe, it, expect, afterEach } from "vitest";
import { sep } from "node:path";
import { resolveRunner, runnerPath } from "../src/index-spawn.js";

const originalRoot = process.env["CLAUDE_PLUGIN_ROOT"];
afterEach(() => {
  if (originalRoot === undefined) delete process.env["CLAUDE_PLUGIN_ROOT"];
  else process.env["CLAUDE_PLUGIN_ROOT"] = originalRoot;
});

describe("resolveRunner", () => {
  it("uses the plugin root when Claude Code sets it", () => {
    expect(resolveRunner("/anywhere/src/index-spawn.ts", "/plug")).toBe(`${sep}plug${sep}hooks${sep}index-runner.js`);
  });

  it("runs the TypeScript source when loaded from src (tests via tsx)", () => {
    expect(resolveRunner("/repo/src/index-spawn.ts")).toBe(`${sep}repo${sep}src${sep}index-runner.ts`);
  });

  it("uses the sibling bundle when loaded from the hooks bundle", () => {
    expect(resolveRunner("/pkg/hooks/session-start.js")).toBe(`${sep}pkg${sep}hooks${sep}index-runner.js`);
  });

  it("reaches back to hooks/ when loaded from tsc output under dist/src", () => {
    expect(resolveRunner("/pkg/dist/src/index-spawn.js")).toBe(`${sep}pkg${sep}hooks${sep}index-runner.js`);
  });
});

describe("runnerPath", () => {
  it("honours CLAUDE_PLUGIN_ROOT", () => {
    process.env["CLAUDE_PLUGIN_ROOT"] = "/plug";
    expect(runnerPath().endsWith(`hooks${sep}index-runner.js`)).toBe(true);
  });

  it("points at a runner file when no plugin root is set", () => {
    delete process.env["CLAUDE_PLUGIN_ROOT"];
    expect(runnerPath()).toMatch(/index-runner\.(ts|js)$/);
  });
});
