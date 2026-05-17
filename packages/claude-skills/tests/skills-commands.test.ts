import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname, "..");

function readFile(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("skill: arcadedb-graph", () => {
  const md = readFile("skills/arcadedb-graph/SKILL.md");

  it("has frontmatter with name and description", () => {
    expect(md).toMatch(/^---/);
    expect(md).toMatch(/name: arcadedb-graph/);
    expect(md).toMatch(/description:.+/);
  });

  it("description includes the key trigger phrases", () => {
    expect(md).toMatch(/how does X work/i);
    expect(md).toMatch(/what calls/i);
    expect(md).toMatch(/decision about/i);
  });

  it("references both code and memory schema types", () => {
    expect(md).toMatch(/:File/);
    expect(md).toMatch(/:Decision/);
    expect(md).toMatch(/:Insight/);
  });
});

describe("command: graph-decision", () => {
  const md = readFile("commands/graph-decision.md");
  it("has frontmatter and shells out to arcadedb-memory record-decision", () => {
    expect(md).toMatch(/^---/);
    expect(md).toMatch(/description:/);
    expect(md).toMatch(/arcadedb-memory record-decision/);
  });
});

describe("command: graph-query", () => {
  const md = readFile("commands/graph-query.md");
  it("has frontmatter and mentions both Cypher and natural-language modes", () => {
    expect(md).toMatch(/^---/);
    expect(md).toMatch(/Cypher/i);
    expect(md).toMatch(/natural-language|natural language/i);
  });
});

describe("command: graph-index", () => {
  const md = readFile("commands/graph-index.md");
  it("has frontmatter and shells out to arcadedb-index", () => {
    expect(md).toMatch(/^---/);
    expect(md).toMatch(/arcadedb-index/);
  });
});

describe("command: graph-status", () => {
  const md = readFile("commands/graph-status.md");
  it("has frontmatter and references arcadedb-memory status", () => {
    expect(md).toMatch(/^---/);
    expect(md).toMatch(/arcadedb-memory status/);
  });
});
