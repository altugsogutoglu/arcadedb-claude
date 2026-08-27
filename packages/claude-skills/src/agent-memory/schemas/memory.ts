import type { PropertyDef, Schema } from "./types.js";

export const EMBEDDING_DIMENSIONS = 384;

/** Types that carry a searchable `embedding`; the embed runner fills it in the background. */
export const EMBEDDED_TYPES = ["Turn", "Decision", "Insight", "Question", "Answer"] as const;
export type EmbeddedType = (typeof EMBEDDED_TYPES)[number];

const embedding: PropertyDef = {
  name: "embedding",
  type: "ARRAY_OF_FLOATS",
  vectorIndex: { dimensions: EMBEDDING_DIMENSIONS, similarity: "COSINE" },
};

export const memorySchema: Schema = {
  name: "memory",
  vertices: [
    {
      name: "Session",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "startedAt", type: "DATETIME", notNull: true },
        { name: "endedAt", type: "DATETIME" },
        { name: "repo", type: "STRING" },
        { name: "summary", type: "STRING" },
      ],
    },
    {
      name: "Turn",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "sessionId", type: "STRING", notNull: true },
        { name: "idx", type: "INTEGER", notNull: true },
        { name: "role", type: "STRING", notNull: true },
        { name: "text", type: "STRING", notNull: true },
        { name: "ts", type: "DATETIME", notNull: true },
        { name: "repo", type: "STRING" },
        embedding,
      ],
    },
    {
      name: "Decision",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "summary", type: "STRING", notNull: true },
        { name: "rationale", type: "STRING" },
        { name: "decidedAt", type: "DATETIME", notNull: true },
        { name: "repo", type: "STRING" },
        embedding,
      ],
    },
    {
      name: "Insight",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "topic", type: "STRING", notNull: true },
        { name: "text", type: "STRING", notNull: true },
        { name: "createdAt", type: "DATETIME", notNull: true },
        { name: "repo", type: "STRING" },
        embedding,
      ],
    },
    {
      name: "Question",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "text", type: "STRING", notNull: true },
        { name: "askedAt", type: "DATETIME", notNull: true },
        { name: "repo", type: "STRING" },
        embedding,
      ],
    },
    {
      name: "Answer",
      properties: [
        { name: "id", type: "STRING", primaryKey: true, notNull: true },
        { name: "text", type: "STRING", notNull: true },
        { name: "answeredAt", type: "DATETIME", notNull: true },
        { name: "confidence", type: "FLOAT" },
        embedding,
      ],
    },
  ],
  edges: [
    { name: "ABOUT" },
    { name: "DURING" },
    { name: "FOLLOWS" },
    { name: "ANSWERS" },
    { name: "SUPERSEDES" },
    { name: "DECIDED_ON" },
    { name: "BLOCKED_BY" },
    { name: "FIXED" },
    { name: "RECOMMENDED_AGAINST" },
  ],
};
