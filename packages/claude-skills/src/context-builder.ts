export interface ProjectContext {
  name: string;
  db: string;
  lastIndexed: string | null;
  fileCount: number;
  importCount: number;
  types: string[];
  autoRegistered?: boolean;
  indexing?: boolean;
}

export interface MemoryContext {
  db: string;
  decisionCount: number;
  insightCount: number;
}

export type EmbedState = "off" | "ready" | "installing" | "missing";

export interface ContextInput {
  project: ProjectContext | null;
  memory: MemoryContext;
  /** Raw :Turn capture on the Stop hook. Defaults to on. */
  capture?: boolean;
  embed?: EmbedState;
  extractorMode?: string;
  serverLine?: string;
}

export function buildContext(input: ContextInput): string {
  const lines: string[] = ["ArcadeDB context loaded:"];
  if (input.serverLine) lines.push(input.serverLine);
  if (input.project) {
    const p = input.project;
    if (p.indexing) {
      lines.push(
        `  Project: ${p.name} (DB: ${p.db}, indexing in background, ${p.fileCount} files so far)`
      );
    } else if (p.autoRegistered && p.lastIndexed === null) {
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
  lines.push(captureLine(input.capture ?? true, input.embed ?? "off"));
  lines.push(extractorLine(input.extractorMode));
  return lines.join("\n");
}

function captureLine(capture: boolean, embed: EmbedState): string {
  if (!capture) return "  Capture: off (ARCADEDB_CAPTURE=on to log every prompt and answer as :Turn)";
  const search =
    embed === "ready" ? "semantic search ready: arcadedb-skills search <query>"
    : embed === "installing" ? "embedding runtime installing in background, search available next session"
    : embed === "missing" ? "embedding runtime missing, run: arcadedb-skills embed install"
    : "embeddings off (ARCADEDB_EMBED=on for semantic search)";
  return `  Capture: on (every prompt/answer logged as :Turn, no LLM; ${search})`;
}

function extractorLine(extractorMode: string | undefined): string {
  const mode = (extractorMode ?? "off").toLowerCase();
  return mode === "off"
    ? "  LLM extractor: off (ARCADEDB_EXTRACTOR=live to distill decisions/insights with a subagent; costs tokens per run)"
    : mode === "dryrun"
      ? "  LLM extractor: dryrun (JSONL audit only; set ARCADEDB_EXTRACTOR=live to write the graph)"
      : "  LLM extractor: live (distilling decisions/insights/Q&A into claude_memory every 10 turns or 15 min; ARCADEDB_EXTRACTOR=off to disable)";
}
