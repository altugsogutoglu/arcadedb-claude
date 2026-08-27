import { describe, it, expect } from "vitest";
import { fuseRanks, luceneQuery, queryTokens } from "../src/search.js";

describe("fuseRanks (reciprocal rank fusion)", () => {
  it("ranks a node found by two retrievers above one found by a single retriever at rank 1", () => {
    const fused = fuseRanks({ vector: ["a", "b", "c"], text: ["b", "d", "c"] });
    expect(fused[0]!.key).toBe("b");
    expect(fused[0]!.via.sort()).toEqual(["text", "vector"]);
    expect(fused.map(f => f.key)).toContain("d");
    expect(fused.find(f => f.key === "d")!.via).toEqual(["text"]);
  });

  it("is deterministic and uses 1/(k+rank)", () => {
    const [top] = fuseRanks({ x: ["only"] }, 60);
    expect(top!.score).toBeCloseTo(1 / 61);
  });
});

describe("luceneQuery", () => {
  it("quotes every token so paths, tickets and shas survive the Lucene lexer", () => {
    expect(luceneQuery('why config/heisterkamp.php "guard" BACKLOG:69 ef71e31d?')).toBe('"why" "config/heisterkamp.php" "guard" "BACKLOG:69" "ef71e31d"');
  });
  it("drops one-char tokens and returns empty for nothing usable", () => {
    expect(luceneQuery("a ? !")).toBe("");
  });
});

describe("queryTokens", () => {
  it("lowercases and drops short tokens", () => {
    expect(queryTokens("Fix HeisterkampClient in v2")).toEqual(["fix", "heisterkampclient"]);
  });
});
