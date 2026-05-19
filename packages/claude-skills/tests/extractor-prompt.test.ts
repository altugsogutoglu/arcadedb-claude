import { describe, it, expect } from "vitest";
import { buildExtractorSystemPrompt } from "../src/extractor-prompt.js";
import { buildVocabSnapshot } from "../src/vocab-snapshot.js";

describe("buildExtractorSystemPrompt", () => {
  const vocab = buildVocabSnapshot();
  const prompt = buildExtractorSystemPrompt(vocab);

  it("lists every known vertex label", () => {
    for (const label of vocab.vertexLabels) {
      expect(prompt).toContain(label);
    }
  });

  it("lists every known edge name", () => {
    for (const edge of vocab.edgeNames) {
      expect(prompt).toContain(edge);
    }
  });

  it("includes the Q&A few-shot example", () => {
    expect(prompt).toMatch(/"label":\s*"Question"/);
    expect(prompt).toMatch(/"label":\s*"Answer"/);
    expect(prompt).toMatch(/"verb":\s*"ANSWERS"/);
  });

  it("includes the Decision few-shot example", () => {
    expect(prompt).toMatch(/"verb":\s*"DECIDED_ON"/);
  });

  it("instructs strict JSON output with evidence quotes", () => {
    expect(prompt).toMatch(/evidence/i);
    expect(prompt).toMatch(/JSON/);
  });

  it("instructs conservative extraction", () => {
    expect(prompt).toMatch(/conservat/i);
  });

  it("includes the Blocker few-shot with unknown_terms", () => {
    expect(prompt).toMatch(/"verb":\s*"BLOCKED_BY"/);
    expect(prompt).toMatch(/unknown_terms/);
    expect(prompt).toMatch(/TIMES_OUT/);
  });
});
