import { describe, it, expect } from "vitest";
import { parseTurnsFromText, cleanText, MAX_TURN_CHARS } from "../src/transcript-turns.js";

const line = (o: unknown) => JSON.stringify(o);
const user = (text: unknown, extra: Record<string, unknown> = {}) => line({ type: "user", timestamp: "2026-08-27T10:00:00.000Z", message: { role: "user", content: text }, ...extra });
const assistant = (content: unknown[]) => line({ type: "assistant", timestamp: "2026-08-27T10:00:01.000Z", message: { role: "assistant", content } });

describe("parseTurnsFromText", () => {
  it("keeps user prompts and assistant prose, drops tool traffic, thinking, system and meta lines", () => {
    const raw = [
      line({ type: "system", subtype: "x" }),
      user("why 3 packages?"),
      assistant([{ type: "thinking", thinking: "hmm" }, { type: "text", text: "Can be one." }, { type: "tool_use", name: "Bash", input: {} }]),
      user([{ type: "tool_result", content: "output" }]),
      user("<command-name>/foo</command-name>", { isMeta: true }),
      line({ type: "attachment" }),
      assistant([{ type: "text", text: "Done." }]),
    ].join("\n") + "\n";
    const turns = parseTurnsFromText(raw, 1, 100);
    expect(turns.map(t => [t.line, t.role, t.text])).toEqual([
      [2, "user", "why 3 packages?"],
      [3, "assistant", "Can be one.\n\nDone."],
    ]);
    expect(turns[0]!.ts).toBe("2026-08-27T10:00:00.000Z");
  });

  it("keeps assistant lines separate once a user prompt sits between them", () => {
    const raw = [assistant([{ type: "text", text: "A" }]), user("q"), assistant([{ type: "text", text: "B" }])].join("\n");
    expect(parseTurnsFromText(raw, 1, 10).map(t => [t.role, t.text])).toEqual([["assistant", "A"], ["user", "q"], ["assistant", "B"]]);
  });

  it("respects the line window (1-based, inclusive)", () => {
    const raw = [user("a"), user("b"), user("c"), user("d")].join("\n");
    expect(parseTurnsFromText(raw, 2, 3).map(t => t.text)).toEqual(["b", "c"]);
    expect(parseTurnsFromText(raw, 5, 9)).toEqual([]);
  });

  it("skips side-chain (subagent) lines and unparsable lines", () => {
    const raw = [user("main"), user("sub", { isSidechain: true }), "not json", user("")].join("\n");
    expect(parseTurnsFromText(raw, 1, 10).map(t => t.text)).toEqual(["main"]);
  });

  it("strips system reminders and command wrappers, drops turns that end up empty", () => {
    expect(cleanText("hi <system-reminder>secret</system-reminder> there")).toBe("hi  there");
    expect(cleanText("<system-reminder>only</system-reminder>")).toBe("");
    const raw = [user("<system-reminder>noise</system-reminder>"), user("<local-command-caveat>x</local-command-caveat>real")].join("\n");
    expect(parseTurnsFromText(raw, 1, 5).map(t => t.text)).toEqual(["real"]);
  });

  it("caps very long turns", () => {
    const raw = user("x".repeat(MAX_TURN_CHARS + 500));
    expect(parseTurnsFromText(raw, 1, 1)[0]!.text.length).toBe(MAX_TURN_CHARS);
  });
});
