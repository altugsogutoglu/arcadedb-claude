import { describe, it, expect } from "vitest";
import {
  clipTranscript, buildSessionPrompt, buildDigestPrompt, parseSessionRollup, parseDigest, isoWeek, digestId,
  MAX_DECISIONS_PER_SESSION,
} from "../src/rollup.js";

const turn = (idx: number, role: string, text: string) => ({ idx, role, text });

describe("clipTranscript", () => {
  it("returns the whole transcript when under budget", () => {
    expect(clipTranscript([turn(1, "user", "hi"), turn(2, "assistant", "hello")])).toBe("[1] user: hi\n\n[2] assistant: hello");
  });
  it("keeps head and tail and says how much was cut", () => {
    const turns = Array.from({ length: 40 }, (_, i) => turn(i + 1, i % 2 ? "assistant" : "user", "x".repeat(100)));
    const out = clipTranscript(turns, 1000);
    expect(out.length).toBeLessThanOrEqual(1100);
    expect(out).toMatch(/^\[1\] user/);
    expect(out).toMatch(/\[40\] assistant: x+$/);
    expect(out).toMatch(/\[\.\.\. \d+ turns omitted \.\.\.\]/);
  });
});

describe("prompts", () => {
  it("session prompt carries repo, transcript, recorded and candidate decisions with ids", () => {
    const p = buildSessionPrompt({
      repo: "transprt.net", startedAt: "2026-08-27T20:00:00.000Z", endedAt: "2026-08-27T20:40:00.000Z",
      turns: [turn(1, "user", "small fix"), turn(2, "assistant", "done")],
      recorded: [{ id: "r1", summary: "Drop test-api default", rationale: "prod safety", decidedAt: "2026-08-27T20:10:00.000Z" }],
      candidates: [{ id: "c1", summary: "Use test API by default", rationale: "", decidedAt: "2026-06-25T10:00:00.000Z" }],
    });
    expect(p).toContain("Repo: transprt.net");
    expect(p).toContain("[1] user: small fix");
    expect(p).toContain("id=r1");
    expect(p).toContain("id=c1");
    expect(p).toContain(`up to ${MAX_DECISIONS_PER_SESSION}`);
  });
  it("digest prompt lists sessions and decisions of the week", () => {
    const p = buildDigestPrompt({
      repo: "a", week: "2026-W35", periodStart: "2026-08-24T00:00:00.000Z", periodEnd: "2026-08-31T00:00:00.000Z",
      sessions: [{ id: "s1", startedAt: "2026-08-27T20:00:00.000Z", title: "Fix guard", summary: "**Outcome** ok" }],
      decisions: [],
    });
    expect(p).toContain("Week 2026-W35");
    expect(p).toContain("Fix guard");
    expect(p).toContain("DECISIONS RECORDED THIS WEEK:\nnone");
  });
});

describe("parseSessionRollup", () => {
  it("accepts a fenced JSON answer and caps decisions", () => {
    const decisions = Array.from({ length: 8 }, (_, i) => ({ summary: `d${i}`, rationale: "r", supersedes: ["c1", 5] }));
    const out = parseSessionRollup("```json\n" + JSON.stringify({ title: "T", summary: "S", decisions }) + "\n```");
    expect(out!.title).toBe("T");
    expect(out!.decisions).toHaveLength(MAX_DECISIONS_PER_SESSION);
    expect(out!.decisions[0]!.supersedes).toEqual(["c1"]);
  });
  it("rejects prose, missing fields and non-objects", () => {
    expect(parseSessionRollup("Sure! Here is the summary.")).toBeNull();
    expect(parseSessionRollup('{"title":"x"}')).toBeNull();
    expect(parseSessionRollup("[1,2]")).toBeNull();
  });
  it("drops decisions without a summary and tolerates a missing decisions array", () => {
    const out = parseSessionRollup('{"title":"t","summary":"s","decisions":[{"rationale":"only"}]}');
    expect(out!.decisions).toEqual([]);
    expect(parseSessionRollup('{"title":"t","summary":"s"}')!.decisions).toEqual([]);
  });
});

describe("parseDigest", () => {
  it("needs title and text", () => {
    expect(parseDigest('{"title":"W35","text":"**Shipped** x"}')).toEqual({ title: "W35", text: "**Shipped** x" });
    expect(parseDigest('{"title":"W35"}')).toBeNull();
  });
});

describe("isoWeek", () => {
  it("buckets by ISO-8601 week with Monday start", () => {
    const w = isoWeek(new Date("2026-08-27T20:00:00Z")); // Thursday
    expect(w.key).toBe("2026-W35");
    expect(w.start.toISOString()).toBe("2026-08-24T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-08-31T00:00:00.000Z");
    expect(isoWeek(new Date("2026-08-30T23:59:59Z")).key).toBe("2026-W35"); // Sunday
    expect(isoWeek(new Date("2026-08-31T00:00:00Z")).key).toBe("2026-W36");
    expect(isoWeek(new Date("2027-01-01T12:00:00Z")).key).toBe("2026-W53");
  });
  it("digest ids are repo-scoped", () => {
    expect(digestId("transprt.net", "2026-W35")).toBe("transprt.net:2026-W35");
  });
});
