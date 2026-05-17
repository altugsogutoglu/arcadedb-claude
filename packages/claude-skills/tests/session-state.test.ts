import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readSessionState,
  writeSessionState,
  type SessionState,
} from "../src/session-state.js";

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "arcadedb-state-"));
  originalHome = process.env["HOME"];
  process.env["HOME"] = tmpHome;
});
afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  if (originalHome !== undefined) process.env["HOME"] = originalHome;
});

describe("session-state", () => {
  it("readSessionState returns null when file does not exist", () => {
    expect(readSessionState("nope")).toBeNull();
  });

  it("writeSessionState then readSessionState round-trips", () => {
    const state: SessionState = {
      claudeCodeSessionId: "cc-abc",
      sessionDbId: "11111111-2222-3333-4444-555555555555",
      repo: "arcadedb-claude",
      cwd: "/Users/test/Herd/arcadedb-claude",
      userName: "Test User",
      startedAt: "2026-05-17T12:00:00.000Z",
      currentTurnIdx: 0,
      lastExtractedTurnIdx: 0,
      lastExtractedAt: "2026-05-17T12:00:00.000Z",
    };
    writeSessionState(state);
    const read = readSessionState("cc-abc");
    expect(read).toEqual(state);
  });

  it("writeSessionState creates ~/.config/arcadedb/sessions/ if absent", () => {
    writeSessionState({
      claudeCodeSessionId: "cc-xyz",
      sessionDbId: "id",
      repo: null,
      cwd: "/tmp",
      userName: "u",
      startedAt: "2026-05-17T12:00:00.000Z",
      currentTurnIdx: 0,
      lastExtractedTurnIdx: 0,
      lastExtractedAt: "2026-05-17T12:00:00.000Z",
    });
    expect(existsSync(join(tmpHome, ".config", "arcadedb", "sessions", "cc-xyz.json"))).toBe(true);
  });

  it("readSessionState returns null on malformed JSON (does not throw)", () => {
    writeSessionState({
      claudeCodeSessionId: "cc-bad",
      sessionDbId: "id",
      repo: null,
      cwd: "/tmp",
      userName: "u",
      startedAt: "2026-05-17T12:00:00.000Z",
      currentTurnIdx: 0,
      lastExtractedTurnIdx: 0,
      lastExtractedAt: "2026-05-17T12:00:00.000Z",
    });
    // corrupt the file
    const path = join(tmpHome, ".config", "arcadedb", "sessions", "cc-bad.json");
    writeFileSync(path, "{not valid json");
    expect(readSessionState("cc-bad")).toBeNull();
  });
});
