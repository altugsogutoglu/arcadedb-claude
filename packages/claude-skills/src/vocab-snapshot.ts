import { allSchemas } from "arcadedb-agent-memory";

export interface VocabSnapshot {
  vertexLabels: string[];
  edgeNames: string[];
  naturalKeys: Record<string, string[]>;
}

const NATURAL_KEYS: Record<string, string[]> = {
  Person: ["name"],
  File: ["path"],
  Function: ["name"],
  Class: ["name"],
  Component: ["name"],
  Repo: ["name"],
  Module: ["path"],
  Concept: ["name"],
  Tag: ["name"],
  Session: ["id"],
  Decision: ["id"],
  Insight: ["id"],
  Question: ["id"],
  Answer: ["id"],
  Note: ["id"],
};

export function buildVocabSnapshot(): VocabSnapshot {
  const labels = new Set<string>();
  const edges = new Set<string>();
  for (const schema of Object.values(allSchemas)) {
    for (const v of schema.vertices) labels.add(v.name);
    for (const e of schema.edges) edges.add(e.name);
  }
  return {
    vertexLabels: [...labels].sort(),
    edgeNames: [...edges].sort(),
    naturalKeys: { ...NATURAL_KEYS },
  };
}
