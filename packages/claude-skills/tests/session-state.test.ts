import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readSessionState,
  writeSessionState,
  incrementTurn,
  markExtracted,
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

  it("writeSessionState overwrites and readSessionState returns the updated value", () => {
    const original: SessionState = {
      claudeCodeSessionId: "cc-update",
      sessionDbId: "id-1",
      repo: "r",
      cwd: "/x",
      userName: "u",
      startedAt: "2026-05-17T12:00:00.000Z",
      currentTurnIdx: 0,
      lastExtractedTurnIdx: 0,
      lastExtractedAt: "2026-05-17T12:00:00.000Z",
    };
    writeSessionState(original);
    const updated: SessionState = { ...original, currentTurnIdx: 5, lastExtractedTurnIdx: 3 };
    writeSessionState(updated);
    expect(readSessionState("cc-update")).toEqual(updated);
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

describe("incrementTurn", () => {
  it("returns the updated state with currentTurnIdx + 1", () => {
    const claudeCodeSessionId = "test-inc-" + Date.now();
    writeSessionState({
      claudeCodeSessionId,
      sessionDbId: "uuid-1",
      repo: "demo",
      cwd: "/tmp",
      userName: "Tester",
      startedAt: "2026-05-19T10:00:00.000Z",
      currentTurnIdx: 4,
      lastExtractedTurnIdx: 0,
      lastExtractedAt: "2026-05-19T10:00:00.000Z",
    });
    const next = incrementTurn(claudeCodeSessionId);
    expect(next?.currentTurnIdx).toBe(5);
  });

  it("returns null when state file is missing", () => {
    expect(incrementTurn("nonexistent-" + Date.now())).toBeNull();
  });

  it("persists the new turn count so a subsequent read sees it", () => {
    const claudeCodeSessionId = "test-inc-persist-" + Date.now();
    writeSessionState({
      claudeCodeSessionId,
      sessionDbId: "uuid-p",
      repo: "demo",
      cwd: "/tmp",
      userName: "Tester",
      startedAt: "2026-05-19T10:00:00.000Z",
      currentTurnIdx: 2,
      lastExtractedTurnIdx: 0,
      lastExtractedAt: "2026-05-19T10:00:00.000Z",
    });
    incrementTurn(claudeCodeSessionId);
    const re = readSessionState(claudeCodeSessionId);
    expect(re?.currentTurnIdx).toBe(3);
  });
});

describe("markExtracted", () => {
  it("updates lastExtractedTurnIdx and lastExtractedAt", () => {
    const claudeCodeSessionId = "test-mark-" + Date.now();
    writeSessionState({
      claudeCodeSessionId,
      sessionDbId: "uuid-2",
      repo: "demo",
      cwd: "/tmp",
      userName: "Tester",
      startedAt: "2026-05-19T10:00:00.000Z",
      currentTurnIdx: 10,
      lastExtractedTurnIdx: 0,
      lastExtractedAt: "2026-05-19T10:00:00.000Z",
    });
    const updated = markExtracted(claudeCodeSessionId, 10);
    expect(updated?.lastExtractedTurnIdx).toBe(10);
    expect(updated?.lastExtractedAt).not.toBe("2026-05-19T10:00:00.000Z");
  });

  it("returns null when state file is missing", () => {
    expect(markExtracted("nope-" + Date.now(), 5)).toBeNull();
  });
});
