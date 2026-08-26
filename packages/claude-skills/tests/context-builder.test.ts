import { describe, it, expect } from "vitest";
import { buildContext } from "../src/context-builder.js";

describe("buildContext", () => {
  it("formats a full project + memory context block", () => {
    const text = buildContext({
      project: {
        name: "project-a",
        db: "project-a",
        lastIndexed: "2026-05-17",
        fileCount: 142,
        importCount: 89,
        types: ["Repo", "Module", "File", "Function"],
      },
      memory: {
        db: "claude_memory",
        decisionCount: 12,
        insightCount: 47,
      },
    });
    expect(text).toMatch(/Project: project-a/);
    expect(text).toMatch(/DB: project-a/);
    expect(text).toMatch(/142 files/);
    expect(text).toMatch(/89 imports/);
    expect(text).toMatch(/claude_memory/);
    expect(text).toMatch(/12 decisions/);
    expect(text).toMatch(/47 insights/);
    expect(text).toMatch(/Repo, Module, File, Function/);
  });

  it("formats memory-only context when no project matched", () => {
    const text = buildContext({
      project: null,
      memory: {
        db: "claude_memory",
        decisionCount: 3,
        insightCount: 8,
      },
    });
    expect(text).not.toMatch(/Project:/);
    expect(text).toMatch(/Memory DB: claude_memory/);
    expect(text).toMatch(/3 decisions, 8 insights/);
  });

  it("handles never-indexed project (lastIndexed null)", () => {
    const text = buildContext({
      project: {
        name: "project-b",
        db: "project-b",
        lastIndexed: null,
        fileCount: 0,
        importCount: 0,
        types: [],
      },
      memory: { db: "claude_memory", decisionCount: 0, insightCount: 0 },
    });
    expect(text).toMatch(/Project: project-b/);
    expect(text).toMatch(/not indexed yet/i);
  });

  it("shows live capture by default (mode undefined)", () => {
    const out = buildContext({
      project: null,
      memory: { db: "claude_memory", decisionCount: 0, insightCount: 0 },
      extractorMode: undefined,
    });
    expect(out).toContain("LLM extractor: live");
  });

  it("shows dryrun when mode=dryrun", () => {
    const out = buildContext({
      project: null,
      memory: { db: "claude_memory", decisionCount: 0, insightCount: 0 },
      extractorMode: "dryrun",
    });
    expect(out).toContain("LLM extractor: dryrun");
  });

  it("shows off when mode=off", () => {
    const out = buildContext({
      project: null,
      memory: { db: "claude_memory", decisionCount: 0, insightCount: 0 },
      extractorMode: "off",
    });
    expect(out).toContain("LLM extractor: off");
  });
});

describe("buildContext - auto-registered project", () => {
  const base = {
    name: "auto-proj",
    db: "auto_proj",
    fileCount: 0,
    importCount: 0,
    types: [],
  };
  const memory = { db: "claude_memory", decisionCount: 0, insightCount: 0 };

  it("uses the auto-registered wording when nothing is indexed yet", () => {
    const text = buildContext({ project: { ...base, lastIndexed: null, autoRegistered: true }, memory });
    expect(text).toMatch(/Project: auto-proj \(DB: auto_proj, auto-registered, not indexed yet, run \/graph-index to index code\)/);
  });

  it("uses the normal wording once the project has been indexed", () => {
    const text = buildContext({ project: { ...base, lastIndexed: "2026-08-27", autoRegistered: true, fileCount: 5, importCount: 2 }, memory });
    expect(text).not.toMatch(/auto-registered/);
    expect(text).toMatch(/indexed: 2026-08-27, 5 files, 2 imports/);
  });

  it("reports background indexing ahead of the auto-registered wording", () => {
    const text = buildContext({ project: { ...base, lastIndexed: null, autoRegistered: true, indexing: true, fileCount: 3 }, memory });
    expect(text).toMatch(/Project: auto-proj \(DB: auto_proj, indexing in background, 3 files so far\)/);
    expect(text).not.toMatch(/auto-registered/);
  });

  it("uses the normal wording for a plain unindexed project", () => {
    const text = buildContext({ project: { ...base, lastIndexed: null }, memory });
    expect(text).not.toMatch(/auto-registered/);
    expect(text).toMatch(/indexed: not indexed yet, 0 files, 0 imports/);
  });
});

describe("buildContext - server line", () => {
  it("prints the server line right after the header when given", () => {
    const out = buildContext({
      project: null,
      memory: { db: "claude_memory", decisionCount: 0, insightCount: 0 },
      serverLine: "  Server: http://localhost:2480 (ok, 3 ms)",
    });
    expect(out.split("\n")[1]).toBe("  Server: http://localhost:2480 (ok, 3 ms)");
  });
});
