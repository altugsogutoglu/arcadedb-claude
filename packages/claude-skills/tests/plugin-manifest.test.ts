import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(__dirname, "../.claude-plugin/plugin.json"), "utf8"));

describe("plugin.json manifest", () => {
  it("has the expected top-level fields", () => {
    expect(manifest.name).toBe("arcadedb-claude-skills");
    expect(manifest.version).toBeTruthy();
    expect(manifest.description).toBeTruthy();
    expect(manifest.license).toBe("MIT");
  });

  it("declares the keywords used by the marketplace", () => {
    expect(manifest.keywords).toEqual(expect.arrayContaining(["arcadedb", "graph", "claude-code"]));
  });

  it("specifies the author and repository", () => {
    expect(manifest.author?.name).toBeTruthy();
    expect(manifest.repository).toMatch(/github\.com.*arcadedb-claude/);
  });
});
