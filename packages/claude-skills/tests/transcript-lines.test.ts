import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countTranscriptLines } from "../src/transcript-lines.js";

describe("countTranscriptLines", () => {
  it("counts newline-terminated lines", () => {
    const p = join(mkdtempSync(join(tmpdir(), "tl-")), "t.jsonl");
    writeFileSync(p, '{"a":1}\n{"b":2}\n{"c":3}\n');
    expect(countTranscriptLines(p)).toBe(3);
  });
  it("counts a final unterminated line", () => {
    const p = join(mkdtempSync(join(tmpdir(), "tl-")), "t.jsonl");
    writeFileSync(p, '{"a":1}\n{"b":2}');
    expect(countTranscriptLines(p)).toBe(2);
  });
  it("returns 0 for empty file", () => {
    const p = join(mkdtempSync(join(tmpdir(), "tl-")), "t.jsonl");
    writeFileSync(p, "");
    expect(countTranscriptLines(p)).toBe(0);
  });
  it("returns 0 for missing path or undefined", () => {
    expect(countTranscriptLines("/definitely/not/here.jsonl")).toBe(0);
    expect(countTranscriptLines(undefined)).toBe(0);
  });
});
