import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const manifest = readFileSync(resolve(__dirname, "..", "agents", "extractor.md"), "utf8");

describe("extractor subagent manifest", () => {
  it("has frontmatter with name=extractor", () => {
    expect(manifest).toMatch(/^---\s*\nname:\s*extractor\s*\n/);
  });

  it("declares the Read, Write, Bash tools", () => {
    expect(manifest).toMatch(/tools:\s*Read,\s*Write,\s*Bash/);
  });

  it("references the extractor-prompt CLI command to materialize the grammar", () => {
    expect(manifest).toContain("extractor-prompt");
  });

  it("documents the extract-write call and live mode", () => {
    expect(manifest).toContain("extract-write");
    expect(manifest).toContain("--mode");
  });

  it("uses the dispatched cli path and line range, not npx", () => {
    expect(manifest).toContain("<cli> extract-write");
    expect(manifest).toContain("<cli> extractor-prompt");
    expect(manifest).toContain("--lines <A>..<B>");
    expect(manifest).toContain("--turn <turn>");
    expect(manifest).not.toContain("npx arcadedb-skills");
    expect(manifest).not.toContain("mark-extracted");
    expect(manifest).not.toContain("import('arcadedb-claude-skills')");
  });
});
