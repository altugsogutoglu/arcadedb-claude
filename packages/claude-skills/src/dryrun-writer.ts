import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { buildExtractorCypher } from "./agent-memory/index.js";
import { dryrunPath } from "./env-paths.js";
import { buildVocabSnapshot } from "./vocab-snapshot.js";
import type { Triple, InvalidTriple } from "./extractor-validator.js";

export interface DryrunBatchArgs {
  sessionDbId: string;
  claudeCodeSessionId: string;
  turnRange: string;
  valid: Triple[];
  invalid: InvalidTriple[];
  pendingVocab: Triple[];
  unknownTerms: unknown[];
}

export function writeDryrunBatch(args: DryrunBatchArgs): void {
  const path = dryrunPath(args.sessionDbId);
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });

  const vocab = buildVocabSnapshot();
  const lines: string[] = [];

  lines.push(JSON.stringify({
    kind: "batch",
    ts: new Date().toISOString(),
    claudeCodeSessionId: args.claudeCodeSessionId,
    turnRange: args.turnRange,
    counts: {
      valid: args.valid.length,
      invalid: args.invalid.length,
      pendingVocab: args.pendingVocab.length,
      unknownTerms: args.unknownTerms.length,
    },
  }));

  for (const triple of args.valid) {
    let cypher = "";
    try {
      cypher = buildExtractorCypher({
        triple: { ...triple, evidence: triple.evidence ?? "" },
        sessionDbId: args.sessionDbId,
        naturalKeys: vocab.naturalKeys,
      });
    } catch (e) {
      cypher = `// cypher-build error: ${(e as Error).message}`;
    }
    lines.push(JSON.stringify({ kind: "triple", triple, cypher }));
  }

  for (const inv of args.invalid) {
    lines.push(JSON.stringify({ kind: "invalid", triple: inv.triple, reason: inv.reason }));
  }

  for (const t of args.pendingVocab) {
    lines.push(JSON.stringify({ kind: "pendingVocab", triple: t }));
  }

  for (const u of args.unknownTerms) {
    lines.push(JSON.stringify({ kind: "unknownTerm", term: u }));
  }

  appendFileSync(path, lines.join("\n") + "\n");
}
