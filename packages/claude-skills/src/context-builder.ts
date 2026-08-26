export interface ProjectContext {
  name: string;
  db: string;
  lastIndexed: string | null;
  fileCount: number;
  importCount: number;
  types: string[];
  autoRegistered?: boolean;
}

export interface MemoryContext {
  db: string;
  decisionCount: number;
  insightCount: number;
}

export interface ContextInput {
  project: ProjectContext | null;
  memory: MemoryContext;
  extractorMode?: string;
}

export function buildContext(input: ContextInput): string {
  const lines: string[] = ["ArcadeDB context loaded:"];
  if (input.project) {
    const p = input.project;
    if (p.autoRegistered && p.lastIndexed === null) {
      lines.push(
        `  Project: ${p.name} (DB: ${p.db}, auto-registered, not indexed yet, run /graph-index to index code)`
      );
    } else {
      const indexed = p.lastIndexed ?? "not indexed yet";
      lines.push(
        `  Project: ${p.name} (DB: ${p.db}, indexed: ${indexed}, ${p.fileCount} files, ${p.importCount} imports)`
      );
    }
    if (p.types.length > 0) {
      lines.push(`  Schema: ${p.types.join(", ")}`);
    }
  }
  lines.push(
    `  Memory DB: ${input.memory.db} (${input.memory.decisionCount} decisions, ${input.memory.insightCount} insights)`
  );
  lines.push(extractorLine(input.extractorMode));
  return lines.join("\n");
}

function extractorLine(extractorMode: string | undefined): string {
  const mode = (extractorMode ?? "live").toLowerCase();
  return mode === "off"
    ? "  LLM extractor: off (set ARCADEDB_EXTRACTOR=live or dryrun to capture)"
    : mode === "dryrun"
      ? "  LLM extractor: dryrun (JSONL audit only; set ARCADEDB_EXTRACTOR=live to write the graph)"
      : "  LLM extractor: live (capturing decisions/insights/Q&A into claude_memory; ARCADEDB_EXTRACTOR=off to disable)";
}
