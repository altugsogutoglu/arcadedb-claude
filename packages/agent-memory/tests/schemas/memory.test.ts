import { describe, it, expect } from "vitest";
import { memorySchema } from "../../src/schemas/memory.js";

describe("memorySchema edges", () => {
  it("includes the v0 vocabulary additions", () => {
    const edgeNames = memorySchema.edges.map(e => e.name);
    expect(edgeNames).toEqual(expect.arrayContaining([
      "DECIDED_ON",
      "BLOCKED_BY",
      "FIXED",
      "RECOMMENDED_AGAINST",
    ]));
  });
});
