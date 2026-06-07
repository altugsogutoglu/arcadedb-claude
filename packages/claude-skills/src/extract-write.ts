import { buildExtractorCypher } from "arcadedb-agent-memory";
import type { Triple } from "./extractor-validator.js";

export interface ExecDeps {
  execute: (db: string, cypher: string) => Promise<unknown>;
  memoryDb: string;
  naturalKeys: Record<string, string[]>;
  sessionDbId: string;
}

export interface LiveResult {
  written: number;
  failed: number;
  errors: string[];
}

export async function executeLiveBatch(valid: Triple[], deps: ExecDeps): Promise<LiveResult> {
  let written = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const triple of valid) {
    try {
      const cypher = buildExtractorCypher({
        triple: { ...triple, evidence: triple.evidence ?? "" },
        sessionDbId: deps.sessionDbId,
        naturalKeys: deps.naturalKeys,
      });
      await deps.execute(deps.memoryDb, cypher);
      written += 1;
    } catch (e) {
      failed += 1;
      errors.push((e as Error).message);
    }
  }
  return { written, failed, errors };
}
