export interface ProjectContext {
  name: string;
  db: string;
  lastIndexed: string | null;
  fileCount: number;
  importCount: number;
  types: string[];
}

export interface MemoryContext {
  db: string;
  decisionCount: number;
  insightCount: number;
}

export interface ContextInput {
  project: ProjectContext | null;
  memory: MemoryContext;
}

export function buildContext(input: ContextInput): string {
  const lines: string[] = ["ArcadeDB context loaded:"];
  if (input.project) {
    const p = input.project;
    const indexed = p.lastIndexed ?? "not indexed yet";
    lines.push(
      `  Project: ${p.name} (DB: ${p.db}, indexed: ${indexed}, ${p.fileCount} files, ${p.importCount} imports)`
    );
    if (p.types.length > 0) {
      lines.push(`  Schema: ${p.types.join(", ")}`);
    }
  }
  lines.push(
    `  Memory DB: ${input.memory.db} (${input.memory.decisionCount} decisions, ${input.memory.insightCount} insights)`
  );
  return lines.join("\n");
}
