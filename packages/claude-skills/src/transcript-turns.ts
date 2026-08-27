import { readFileSync } from "node:fs";

export interface TranscriptTurn {
  /** 1-based transcript line the turn came from. */
  line: number;
  role: "user" | "assistant";
  text: string;
  ts: string;
}

/** Longest text stored per turn. Assistant answers rarely exceed this; tool dumps are not captured at all. */
export const MAX_TURN_CHARS = 32_000;

interface RawLine {
  type?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  timestamp?: string;
  message?: { role?: string; content?: unknown };
}

/**
 * Pull the human-readable conversation out of a Claude Code transcript slice:
 * user prompts and assistant prose. Tool calls, tool results, thinking, system
 * lines, and subagent side chains are skipped. Nothing here calls a model.
 */
export function parseTranscriptTurns(path: string, fromLine: number, toLine: number): TranscriptTurn[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  return parseTurnsFromText(raw, fromLine, toLine);
}

export function parseTurnsFromText(raw: string, fromLine: number, toLine: number): TranscriptTurn[] {
  const out: TranscriptTurn[] = [];
  const lines = raw.split("\n");
  const last = Math.min(toLine, lines.length);
  for (let i = Math.max(fromLine, 1); i <= last; i++) {
    const text = lines[i - 1];
    if (!text || !text.trim()) continue;
    let entry: RawLine;
    try {
      entry = JSON.parse(text) as RawLine;
    } catch {
      continue;
    }
    const turn = turnFromEntry(entry, i);
    if (turn) out.push(turn);
  }
  return out;
}

function turnFromEntry(entry: RawLine, line: number): TranscriptTurn | null {
  if (entry.isMeta || entry.isSidechain) return null;
  if (entry.type !== "user" && entry.type !== "assistant") return null;
  const content = entry.message?.content;
  let text: string;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter((p): p is { type: string; text: string } => !!p && typeof p === "object" && (p as { type?: string }).type === "text" && typeof (p as { text?: unknown }).text === "string")
      .map(p => p.text)
      .join("\n");
  } else {
    return null;
  }
  text = cleanText(text);
  if (!text) return null;
  return {
    line,
    role: entry.type,
    text: text.length > MAX_TURN_CHARS ? text.slice(0, MAX_TURN_CHARS) : text,
    ts: entry.timestamp ?? new Date().toISOString(),
  };
}

/** Strip harness noise the user never typed and Claude never said. */
export function cleanText(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
    .replace(/<command-(?:name|message|args)>[\s\S]*?<\/command-(?:name|message|args)>/g, "")
    .trim();
}
