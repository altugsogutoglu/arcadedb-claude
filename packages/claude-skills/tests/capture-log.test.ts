import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logCapture } from "../src/capture-log.js";

let tmpHome: string;
let originalHome: string | undefined;
beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "arcadedb-caplog-"));
  originalHome = process.env["HOME"];
  process.env["HOME"] = tmpHome;
});
afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  if (originalHome !== undefined) process.env["HOME"] = originalHome;
});

describe("logCapture", () => {
  it("creates the file and appends one JSON line per call", () => {
    logCapture("trigger", { session: "s1", lines: "1..40" });
    logCapture("skip", { reason: "no-state" });
    const path = join(tmpHome, ".config", "arcadedb", "capture.log");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf8").trim().split("\n").map(l => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ event: "trigger", session: "s1", lines: "1..40" });
    expect(lines[1]).toMatchObject({ event: "skip", reason: "no-state" });
    expect(typeof lines[0].ts).toBe("string");
  });
});
