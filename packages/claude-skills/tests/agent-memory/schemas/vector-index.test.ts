import { describe, it, expect } from "vitest";
import { renderSchema } from "../../../src/agent-memory/migrations/render.js";
import { memorySchema, EMBEDDED_TYPES, EMBEDDING_DIMENSIONS } from "../../../src/agent-memory/schemas/memory.js";

describe("memory schema vectors", () => {
  const stmts = renderSchema(memorySchema);

  it("declares Turn with the raw-capture fields", () => {
    expect(stmts).toContain("CREATE VERTEX TYPE Turn IF NOT EXISTS");
    for (const p of ["sessionId", "idx", "role", "text", "ts"]) {
      expect(stmts.some(s => s.startsWith(`CREATE PROPERTY Turn.${p} IF NOT EXISTS`))).toBe(true);
    }
  });

  it("gives every embedded type an ARRAY_OF_FLOATS embedding and an LSM_VECTOR cosine index", () => {
    for (const t of EMBEDDED_TYPES) {
      expect(stmts).toContain(`CREATE PROPERTY ${t}.embedding IF NOT EXISTS ARRAY_OF_FLOATS`);
      expect(stmts).toContain(`CREATE INDEX IF NOT EXISTS ON ${t}(embedding) LSM_VECTOR METADATA {"dimensions":${EMBEDDING_DIMENSIONS},"similarity":"COSINE"}`);
    }
    expect(EMBEDDING_DIMENSIONS).toBe(384);
  });

  it("gives every searchable text property a FULL_TEXT index and declares Ref/MENTIONS", () => {
    for (const [t, p] of [["Turn", "text"], ["Decision", "summary"], ["Decision", "rationale"], ["Insight", "topic"], ["Insight", "text"], ["Question", "text"], ["Answer", "text"]]) {
      expect(stmts).toContain(`CREATE INDEX IF NOT EXISTS ON ${t}(${p}) FULL_TEXT`);
    }
    expect(stmts).toContain("CREATE VERTEX TYPE Ref IF NOT EXISTS");
    expect(stmts).toContain("CREATE INDEX IF NOT EXISTS ON Ref(id) UNIQUE");
    expect(stmts).toContain("CREATE EDGE TYPE MENTIONS IF NOT EXISTS");
  });
});
