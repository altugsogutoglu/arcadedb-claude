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
});
