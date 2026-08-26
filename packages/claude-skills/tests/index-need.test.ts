import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { staleEditsSince, decideIndexNeed } from "../src/index-need.js";

function stale(lines: string[]): string {
  const p = join(mkdtempSync(join(tmpdir(), "stale-")), "stale.log");
  writeFileSync(p, lines.join("\n") + (lines.length ? "\n" : ""));
  return p;
}

describe("staleEditsSince", () => {
  it("counts only this key's lines newer than since", () => {
    const p = stale([
      "[2026-08-01T10:00:00.000Z] proj-a (cwd=/x)",
      "[2026-08-02T10:00:00.000Z] proj-a (cwd=/x)",
      "[2026-08-03T10:00:00.000Z] proj-b (cwd=/y)",
    ]);
    expect(staleEditsSince(p, "proj-a", "2026-08-01T12:00:00.000Z")).toBe(1);
    expect(staleEditsSince(p, "proj-a", null)).toBe(2);
    expect(staleEditsSince(p, "proj-b", "2026-08-04T00:00:00.000Z")).toBe(0);
  });
  it("returns 0 for a missing file", () => {
    expect(staleEditsSince("/nope/stale.log", "x", null)).toBe(0);
  });
});

describe("decideIndexNeed", () => {
  it("never_indexed when lastIndexed is null", () => {
    const p = stale([]);
    expect(decideIndexNeed({ lastIndexed: null }, "k", p, true)).toEqual({ needed: true, reason: "never_indexed", staleEdits: 0 });
  });
  it("stale when edits after lastIndexed", () => {
    const p = stale(["[2026-08-05T00:00:00.000Z] k (cwd=/x)"]);
    expect(decideIndexNeed({ lastIndexed: "2026-08-04T00:00:00.000Z" }, "k", p, true)).toEqual({ needed: true, reason: "stale", staleEdits: 1 });
  });
  it("fresh when no newer edits", () => {
    const p = stale(["[2026-08-03T00:00:00.000Z] k (cwd=/x)"]);
    expect(decideIndexNeed({ lastIndexed: "2026-08-04T00:00:00.000Z" }, "k", p, true).needed).toBe(false);
  });
  it("auto_index_off wins", () => {
    const p = stale([]);
    expect(decideIndexNeed({ lastIndexed: null }, "k", p, false)).toEqual({ needed: false, reason: "auto_index_off", staleEdits: 0 });
  });
});
