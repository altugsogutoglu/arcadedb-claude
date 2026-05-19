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

  it("shows extractor off with hint when ARCADEDB_EXTRACTOR is unset", () => {
    const text = buildContext({
      project: null,
      memory: { db: "claude_memory", decisionCount: 0, insightCount: 0 },
    });
    expect(text).toMatch(/LLM extractor: off/);
    expect(text).toMatch(/ARCADEDB_EXTRACTOR=dryrun/);
  });

  it("shows extractor dryrun status when opted in", () => {
    const text = buildContext({
      project: null,
      memory: { db: "claude_memory", decisionCount: 0, insightCount: 0 },
      extractorMode: "dryrun",
    });
    expect(text).toMatch(/LLM extractor: dryrun/);
    expect(text).toMatch(/no DB writes/);
  });
});
