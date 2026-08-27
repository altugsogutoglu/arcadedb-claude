import { describe, it, expect } from "vitest";
import { renderSchema } from "../../../src/agent-memory/migrations/render.js";
import type { Schema } from "../../../src/agent-memory/schemas/types.js";

const example: Schema = {
  name: "example",
  vertices: [
    { name: "Foo", properties: [{ name: "id", type: "STRING", primaryKey: true }] },
    { name: "Bar", properties: [{ name: "n", type: "INTEGER" }] },
  ],
  edges: [
    { name: "RELATED_TO" },
  ],
};

describe("renderSchema", () => {
  it("produces idempotent CREATE statements", () => {
    const stmts = renderSchema(example);
    expect(stmts).toContain("CREATE VERTEX TYPE Foo IF NOT EXISTS");
    expect(stmts).toContain("CREATE VERTEX TYPE Bar IF NOT EXISTS");
    expect(stmts).toContain("CREATE EDGE TYPE RELATED_TO IF NOT EXISTS");
  });

  it("adds property declarations and primary key index", () => {
    const stmts = renderSchema(example);
    const flat = stmts.join("\n");
    expect(flat).toMatch(/CREATE PROPERTY Foo\.id IF NOT EXISTS STRING/);
    expect(flat).toMatch(/CREATE INDEX IF NOT EXISTS ON Foo\(id\) UNIQUE/);
    expect(flat).toMatch(/CREATE PROPERTY Bar\.n IF NOT EXISTS INTEGER/);
  });
});
