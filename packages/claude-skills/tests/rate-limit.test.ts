import { describe, it, expect } from "vitest";
import { shouldExtract } from "../src/rate-limit.js";

describe("shouldExtract", () => {
  const baseState = {
    currentTurnIdx: 5,
    lastExtractedTurnIdx: 0,
    lastExtractedAt: "2026-05-19T10:00:00.000Z",
  };
  const cfg = { turns: 10, intervalMs: 15 * 60 * 1000 };

  it("trips when turn delta exceeds threshold", () => {
    expect(shouldExtract(
      { ...baseState, currentTurnIdx: 10, lastExtractedTurnIdx: 0 },
      cfg,
      new Date("2026-05-19T10:01:00.000Z"),
    )).toBe(true);
  });

  it("trips when interval exceeds threshold", () => {
    expect(shouldExtract(
      baseState,
      cfg,
      new Date("2026-05-19T10:16:00.000Z"),
    )).toBe(true);
  });

  it("does not trip when neither threshold met", () => {
    expect(shouldExtract(
      baseState,
      cfg,
      new Date("2026-05-19T10:05:00.000Z"),
    )).toBe(false);
  });

  it("does not trip when currentTurnIdx <= lastExtractedTurnIdx", () => {
    expect(shouldExtract(
      { ...baseState, currentTurnIdx: 0, lastExtractedTurnIdx: 0 },
      cfg,
      new Date("2026-05-19T10:30:00.000Z"),
    )).toBe(false);
  });
});
