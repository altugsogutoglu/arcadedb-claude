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
