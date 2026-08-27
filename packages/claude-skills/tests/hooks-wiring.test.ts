import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const cfg = JSON.parse(readFileSync(resolve(__dirname, "../hooks/hooks.json"), "utf8"));

describe("hooks.json", () => {
  it("declares a SessionStart hook pointing at the bundled session-start script", () => {
    const ss = cfg.hooks?.SessionStart?.[0]?.hooks ?? [];
    const cmd = ss.find((h: { type: string; command?: string }) => h.type === "command");
    expect(cmd?.command).toMatch(/\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/session-start\.js/);
  });

  it("declares a PostToolUse hook for Edit/Write tools pointing at the bundled script", () => {
    const ptu = cfg.hooks?.PostToolUse?.[0];
    expect(ptu?.matcher).toMatch(/Edit|Write/);
    const cmd = ptu?.hooks?.find((h: { type: string; command?: string }) => h.type === "command");
    expect(cmd?.command).toMatch(/\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/post-tool-use\.js/);
  });

  it("registers a SessionEnd hook pointing at session-end.js", () => {
    expect(Array.isArray(cfg.hooks?.SessionEnd)).toBe(true);
    const cmd = cfg.hooks?.SessionEnd?.[0]?.hooks?.find((h: { type: string; command?: string }) => h.type === "command");
    expect(cmd?.command).toMatch(/\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/session-end\.js/);
  });

  it("registers a Stop hook pointing at stop.js", () => {
    expect(Array.isArray(cfg.hooks?.Stop)).toBe(true);
    const cmd = cfg.hooks?.Stop?.[0]?.hooks?.find((h: { type: string; command?: string }) => h.type === "command");
    expect(cmd?.command).toMatch(/\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/stop\.js/);
  });

  it("ships a bundled cli at hooks/cli.js", () => {
    expect(existsSync(join(__dirname, "..", "hooks", "cli.js"))).toBe(true);
  });

  it("ships a bundled indexer at hooks/index-runner.js and no stale hooks/index.js", () => {
    expect(existsSync(join(__dirname, "..", "hooks", "index-runner.js"))).toBe(true);
    expect(existsSync(join(__dirname, "..", "hooks", "index.js"))).toBe(false);
  });

  it("gives the SessionStart command hook an explicit 15 second timeout", () => {
    const cmd = cfg.hooks?.SessionStart?.[0]?.hooks?.find((h: { type: string }) => h.type === "command");
    expect(cmd?.timeout).toBe(15);
  });
});
