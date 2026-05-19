import { describe, it, expect } from "vitest";
import { validateExtraction } from "../src/extractor-validator.js";
import { buildVocabSnapshot } from "../src/vocab-snapshot.js";

const vocab = buildVocabSnapshot();

describe("validateExtraction", () => {
  it("rejects non-JSON input", () => {
    const r = validateExtraction("not json", vocab);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/parse/i);
  });

  it("rejects when triples is not an array", () => {
    const r = validateExtraction(JSON.stringify({ triples: "nope" }), vocab);
    expect(r.ok).toBe(false);
  });

  it("accepts a valid triple", () => {
    const r = validateExtraction(JSON.stringify({
      triples: [{
        subject: { label: "Person", props: { name: "Altug" } },
        verb: "DECIDED_ON",
        object: { label: "Concept", props: { name: "Redis" } },
        evidence: "use redis for the rate limiter",
        confidence: 0.95,
      }],
    }), vocab);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valid).toHaveLength(1);
    expect(r.invalid).toHaveLength(0);
    expect(r.pendingVocab).toHaveLength(0);
  });

  it("moves triples with unknown verbs to pendingVocab", () => {
    const r = validateExtraction(JSON.stringify({
      triples: [{
        subject: { label: "Person", props: { name: "Altug" } },
        verb: "TIMES_OUT",
        object: { label: "Concept", props: { name: "ArcadeDB" } },
        evidence: "endpoint times out from hook context",
      }],
    }), vocab);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valid).toHaveLength(0);
    expect(r.pendingVocab).toHaveLength(1);
  });

  it("moves triples with unknown vertex labels to pendingVocab", () => {
    const r = validateExtraction(JSON.stringify({
      triples: [{
        subject: { label: "Spaceship", props: { name: "X" } },
        verb: "DECIDED_ON",
        object: { label: "Concept", props: { name: "Y" } },
        evidence: "x decided on y",
      }],
    }), vocab);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pendingVocab).toHaveLength(1);
  });

  it("drops triples missing evidence", () => {
    const r = validateExtraction(JSON.stringify({
      triples: [{
        subject: { label: "Person", props: { name: "Altug" } },
        verb: "DECIDED_ON",
        object: { label: "Concept", props: { name: "Redis" } },
      }],
    }), vocab);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valid).toHaveLength(0);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0].reason).toMatch(/evidence/i);
  });

  it("drops triples missing the natural key for a vertex", () => {
    const r = validateExtraction(JSON.stringify({
      triples: [{
        subject: { label: "Person", props: {} },
        verb: "DECIDED_ON",
        object: { label: "Concept", props: { name: "Redis" } },
        evidence: "ok",
      }],
    }), vocab);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0].reason).toMatch(/natural key/i);
  });

  it("passes through unknown_terms array verbatim", () => {
    const r = validateExtraction(JSON.stringify({
      triples: [],
      unknown_terms: [{ candidate: "X", kind: "verb", context: "..." }],
    }), vocab);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unknownTerms).toEqual([{ candidate: "X", kind: "verb", context: "..." }]);
  });
});
