import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
});
