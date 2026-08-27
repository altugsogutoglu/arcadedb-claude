import type { Schema, VertexTypeDef, EdgeTypeDef, PropertyDef } from "../schemas/types.js";

export function renderSchema(s: Schema): string[] {
  const out: string[] = [];
  for (const v of s.vertices) out.push(...renderVertex(v));
  for (const e of s.edges) out.push(...renderEdge(e));
  return out;
}

function renderVertex(v: VertexTypeDef): string[] {
  const stmts = [`CREATE VERTEX TYPE ${v.name} IF NOT EXISTS`];
  for (const p of v.properties ?? []) {
    stmts.push(...renderProperty(v.name, p));
  }
  return stmts;
}

function renderEdge(e: EdgeTypeDef): string[] {
  const stmts = [`CREATE EDGE TYPE ${e.name} IF NOT EXISTS`];
  for (const p of e.properties ?? []) {
    stmts.push(...renderProperty(e.name, p));
  }
  return stmts;
}

function renderProperty(typeName: string, p: PropertyDef): string[] {
  const stmts = [`CREATE PROPERTY ${typeName}.${p.name} IF NOT EXISTS ${p.type}`];
  if (p.primaryKey) {
    stmts.push(`CREATE INDEX IF NOT EXISTS ON ${typeName}(${p.name}) UNIQUE`);
  }
  return stmts;
}
