import { coreSchema } from "./core.js";
import { memorySchema } from "./memory.js";
import { codeSchema } from "./code.js";
import { businessSchema } from "./business.js";
import { notesSchema } from "./notes.js";
import type { Schema } from "./types.js";

export const allSchemas: Record<string, Schema> = {
  core: coreSchema,
  memory: memorySchema,
  code: codeSchema,
  business: businessSchema,
  notes: notesSchema,
};

export type SchemaDomain = keyof typeof allSchemas;

export { coreSchema, memorySchema, codeSchema, businessSchema, notesSchema };
