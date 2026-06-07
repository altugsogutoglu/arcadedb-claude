import { describe, it, expect } from "vitest";
import { executeLiveBatch } from "../src/extract-write.js";
import type { Triple } from "../src/extractor-validator.js";

const naturalKeys = { Decision: ["summary"], Concept: ["name"], Insight: ["topic"] };

const triple: Triple = {
  subject: { label: "Decision", props: { summary: "use claude_memory" } },
  verb: "DECIDED_ON",
  object: { label: "Concept", props: { name: "memory db" } },
  evidence: "we picked claude_memory",
  confidence: 0.9,
};

describe("executeLiveBatch", () => {
  it("executes one Cypher command per valid triple against the memory db", async () => {
    const calls: { db: string; cypher: string }[] = [];
    const result = await executeLiveBatch([triple], {
      execute: async (db, cypher) => { calls.push({ db, cypher }); return []; },
      memoryDb: "claude_memory",
      naturalKeys,
      sessionDbId: "sess-1",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].db).toBe("claude_memory");
    expect(calls[0].cypher).toContain("MERGE (s:Decision");
    expect(calls[0].cypher).toContain("DECIDED_ON");
    expect(result).toEqual({ written: 1, failed: 0, errors: [] });
  });

  it("counts failures without throwing", async () => {
    const result = await executeLiveBatch([triple], {
      execute: async () => { throw new Error("boom"); },
      memoryDb: "claude_memory",
      naturalKeys,
      sessionDbId: "sess-1",
    });
    expect(result.written).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain("boom");
  });
});
