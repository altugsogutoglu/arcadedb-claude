import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { walkVault } from "../../src/obsidian-sync/walker.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const vaultRoot = resolve(__dirname, "fixtures/tiny-vault");

describe("walkVault", () => {
  it("finds all 5 markdown files in the fixture vault", async () => {
    const files = await walkVault(vaultRoot);
    expect(files).toEqual(expect.arrayContaining([
      "Home.md",
      "Ideas.md",
      "Notes on Z.md",
      "Hub.md",
      "projects/Big Idea.md",
    ]));
    expect(files).toHaveLength(5);
  });

  it("excludes .obsidian, .git, and non-md files by default", async () => {
    const files = await walkVault(vaultRoot);
    expect(files.every(f => f.endsWith(".md"))).toBe(true);
    expect(files.every(f => !f.startsWith(".obsidian/"))).toBe(true);
    expect(files.every(f => !f.startsWith(".git/"))).toBe(true);
  });

  it("returns sorted relative paths", async () => {
    const files = await walkVault(vaultRoot);
    expect([...files].sort()).toEqual(files);
  });
});
