import { describe, it, expect } from "vitest";
import { parseHookInput } from "../src/hook-input.js";

describe("parseHookInput", () => {
  it("returns known fields from valid JSON", () => {
    const out = parseHookInput(JSON.stringify({
      session_id: "s1", transcript_path: "/t.jsonl", cwd: "/repo", hook_event_name: "Stop", stop_hook_active: false,
    }));
    expect(out).toEqual({
      session_id: "s1", transcript_path: "/t.jsonl", cwd: "/repo", hook_event_name: "Stop", stop_hook_active: false,
    });
  });
  it("returns {} on empty input", () => { expect(parseHookInput("")).toEqual({}); });
  it("returns {} on invalid JSON", () => { expect(parseHookInput("{nope")).toEqual({}); });
  it("drops unknown fields", () => {
    expect(parseHookInput(JSON.stringify({ session_id: "x", extra: 1 }))).toEqual({ session_id: "x" });
  });
});
