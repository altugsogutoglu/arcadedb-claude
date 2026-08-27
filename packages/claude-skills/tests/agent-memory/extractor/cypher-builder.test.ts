import { describe, it, expect } from "vitest";
import { buildExtractorCypher } from "../../../src/agent-memory/extractor/cypher-builder.js";

describe("buildExtractorCypher", () => {
  const naturalKeys = { Person: ["name"], Concept: ["name"] };

  it("emits MERGE for subject, object, and edge with bookkeeping", () => {
    const cy = buildExtractorCypher({
      triple: {
        subject: { label: "Person", props: { name: "Altug" } },
        verb: "DECIDED_ON",
        object: { label: "Concept", props: { name: "Redis" } },
        evidence: "use redis",
        confidence: 0.95,
      },
      sessionDbId: "sess-uuid",
      naturalKeys,
    });
    expect(cy).toMatch(/MERGE \(s:Person \{name:"Altug"\}\)/);
    expect(cy).toMatch(/MERGE \(o:Concept \{name:"Redis"\}\)/);
    expect(cy).toMatch(/MERGE \(s\)-\[r:DECIDED_ON\]->\(o\)/);
    expect(cy).toMatch(/r\.session = "sess-uuid"/);
    expect(cy).toMatch(/r\.evidence = "use redis"/);
    expect(cy).toMatch(/r\.confidence = 0\.95/);
    expect(cy).toMatch(/MERGE \(sess:Session \{id: "sess-uuid"\}\)/);
    expect(cy).toMatch(/MERGE \(s\)-\[:DURING\]->\(sess\)/);
  });

  it("sets every scalar prop besides the natural key, and stamps the schema timestamp on create", () => {
    const cy = buildExtractorCypher({
      triple: {
        subject: { label: "Decision", props: { id: "d1", summary: "one package", rationale: "less drift", nested: { x: 1 }, none: null } },
        verb: "ABOUT",
        object: { label: "Concept", props: { name: "npm", weight: 2 } },
        evidence: "ok",
      },
      sessionDbId: "s",
      naturalKeys: { ...naturalKeys, Decision: ["id"] },
    });
    expect(cy).toMatch(/MERGE \(s:Decision \{id:"d1"\}\)\n  ON CREATE SET s\.firstSeenAt = datetime\(\), s\.decidedAt = datetime\(\)\nSET s\.summary = "one package",\n    s\.rationale = "less drift"/);
    expect(cy).not.toMatch(/s\.nested|s\.none|s\.id =/);
    expect(cy).toMatch(/MERGE \(o:Concept \{name:"npm"\}\)\n  ON CREATE SET o\.firstSeenAt = datetime\(\)\nSET o\.weight = 2/);
  });

  it("keeps a timestamp the extractor supplied", () => {
    const cy = buildExtractorCypher({
      triple: {
        subject: { label: "Insight", props: { id: "i1", topic: "t", text: "x", createdAt: "2026-01-01T00:00:00Z" } },
        verb: "ABOUT",
        object: { label: "Concept", props: { name: "npm" } },
        evidence: "ok",
      },
      sessionDbId: "s",
      naturalKeys: { ...naturalKeys, Insight: ["id"] },
    });
    expect(cy).toMatch(/ON CREATE SET s\.firstSeenAt = datetime\(\)\nSET/);
    expect(cy).toMatch(/s\.createdAt = "2026-01-01T00:00:00Z"/);
  });

  it("omits confidence when not provided", () => {
    const cy = buildExtractorCypher({
      triple: {
        subject: { label: "Person", props: { name: "Altug" } },
        verb: "DECIDED_ON",
        object: { label: "Concept", props: { name: "Redis" } },
        evidence: "use redis",
      },
      sessionDbId: "s",
      naturalKeys,
    });
    expect(cy).not.toMatch(/r\.confidence/);
  });

  it("escapes embedded quotes in evidence", () => {
    const cy = buildExtractorCypher({
      triple: {
        subject: { label: "Person", props: { name: "Altug" } },
        verb: "DECIDED_ON",
        object: { label: "Concept", props: { name: "Redis" } },
        evidence: 'said "ok" then "go"',
      },
      sessionDbId: "sess-uuid",
      naturalKeys,
    });
    expect(cy).toContain('said \\"ok\\" then \\"go\\"');
  });

  it("escapes embedded backslashes", () => {
    const cy = buildExtractorCypher({
      triple: {
        subject: { label: "Person", props: { name: "back\\slash" } },
        verb: "DECIDED_ON",
        object: { label: "Concept", props: { name: "x" } },
        evidence: "ok",
      },
      sessionDbId: "s",
      naturalKeys,
    });
    expect(cy).toContain('back\\\\slash');
  });

  it("throws if a label has no natural key configured", () => {
    expect(() => buildExtractorCypher({
      triple: {
        subject: { label: "Mystery", props: { name: "X" } },
        verb: "DECIDED_ON",
        object: { label: "Concept", props: { name: "Y" } },
        evidence: "ok",
      },
      sessionDbId: "s",
      naturalKeys,
    })).toThrow(/no natural key/i);
  });
});
