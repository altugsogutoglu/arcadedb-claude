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

  it("documents the dry-run output path", () => {
    expect(manifest).toMatch(/~\/\.config\/arcadedb\/dryrun\/<sessionDbId>\.jsonl/);
  });

  it("references the three helper exports from arcadedb-claude-skills", () => {
    expect(manifest).toContain("buildExtractorSystemPrompt");
    expect(manifest).toContain("validateExtraction");
    expect(manifest).toContain("writeDryrunBatch");
  });

  it("references the mark-extracted CLI", () => {
    expect(manifest).toContain("mark-extracted");
  });

  it("declares it does NOT write to the live database in v1", () => {
    expect(manifest).toMatch(/do not write to the live database/i);
  });
});
