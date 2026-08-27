/**
 * Pure pieces of the session rollup: input clipping, prompt building, response validation, ISO weeks.
 * Nothing here touches the database or a model, so it is unit-testable and cheap to reason about.
 */

export interface RollupTurn {
  idx: number;
  role: string;
  text: string;
}

export interface CandidateDecision {
  id: string;
  summary: string;
  rationale: string;
  decidedAt: string;
}

export interface SessionRollupInput {
  repo: string;
  startedAt: string;
  endedAt: string | null;
  turns: RollupTurn[];
  /** Decisions already recorded DURING this session (by /graph-decision or the extractor). */
  recorded: CandidateDecision[];
  /** Prior decisions of the repo that the session may have replaced; the model judges supersession. */
  candidates: CandidateDecision[];
}

export interface SessionRollup {
  title: string;
  summary: string;
  decisions: { summary: string; rationale: string; supersedes: string[] }[];
}

export interface DigestInput {
  repo: string;
  week: string;
  periodStart: string;
  periodEnd: string;
  sessions: { id: string; startedAt: string; title: string | null; summary: string }[];
  decisions: CandidateDecision[];
}

export interface Digest {
  title: string;
  text: string;
}

/** Transcript characters handed to the model per session; head and tail are kept, the middle is cut. */
export const MAX_TRANSCRIPT_CHARS = 24_000;
/** Sessions shorter than this are not summarised (a "hi" and one answer is not a session). */
export const MIN_TURNS_FOR_ROLLUP = 4;
export const MAX_DECISIONS_PER_SESSION = 5;
export const MAX_ROLLUP_ATTEMPTS = 3;

/** Render turns as a transcript, keeping the first and last part when the whole is over budget. */
export function clipTranscript(turns: RollupTurn[], maxChars = MAX_TRANSCRIPT_CHARS): string {
  const lines = turns.map(t => `[${t.idx}] ${t.role}: ${t.text.trim()}`);
  const full = lines.join("\n\n");
  if (full.length <= maxChars) return full;
  const headBudget = Math.floor(maxChars * 0.6);
  const tailBudget = maxChars - headBudget;
  const head: string[] = [];
  let used = 0;
  for (const l of lines) {
    if (used + l.length + 2 > headBudget) break;
    head.push(l);
    used += l.length + 2;
  }
  const tail: string[] = [];
  used = 0;
  for (let i = lines.length - 1; i >= head.length; i--) {
    const l = lines[i]!;
    if (used + l.length + 2 > tailBudget) break;
    tail.unshift(l);
    used += l.length + 2;
  }
  const cut = lines.length - head.length - tail.length;
  return [...head, `[... ${cut} turns omitted ...]`, ...tail].join("\n\n");
}

export const SESSION_SYSTEM_PROMPT =
  "You summarise one Claude Code session for a developer's long-term memory graph. " +
  "Answer with strict JSON only, no prose, no markdown fences.";

export function buildSessionPrompt(input: SessionRollupInput): string {
  const fmt = (d: CandidateDecision): string => `- id=${d.id} (${d.decidedAt.slice(0, 10)}): ${d.summary}${d.rationale ? ` — ${d.rationale}` : ""}`;
  return [
    `Repo: ${input.repo}`,
    `Session: ${input.startedAt.slice(0, 16)} to ${(input.endedAt ?? "").slice(0, 16) || "?"}, ${input.turns.length} turns.`,
    "",
    "TRANSCRIPT (user prompts and assistant answers, tool output omitted):",
    clipTranscript(input.turns),
    "",
    input.recorded.length ? "DECISIONS ALREADY RECORDED FOR THIS SESSION (do not repeat them):\n" + input.recorded.map(fmt).join("\n") : "DECISIONS ALREADY RECORDED FOR THIS SESSION: none",
    "",
    input.candidates.length
      ? "PRIOR DECISIONS OF THIS REPO THAT MIGHT NOW BE REPLACED (use their id in `supersedes` only when this session clearly reversed or replaced them):\n" + input.candidates.map(fmt).join("\n")
      : "PRIOR DECISIONS OF THIS REPO: none",
    "",
    "Return JSON with exactly this shape:",
    "{",
    '  "title": "<= 80 chars, what the session was about",',
    '  "summary": "markdown, <= 1200 chars, sections: **Outcome**, **Changed** (files, commits, versions), **Decided** (with why), **Open** (unfinished, blockers)",',
    `  "decisions": [ up to ${MAX_DECISIONS_PER_SESSION} NEW durable decisions: {"summary": "<= 160 chars", "rationale": "<= 300 chars", "supersedes": ["<prior id>"]} ]`,
    "}",
    "Rules: decisions are choices with lasting effect (architecture, library, process, naming), not tasks done. " +
    "Empty `decisions` is a good answer for a session without one. `supersedes` ids must come from the prior list.",
  ].join("\n");
}

export const DIGEST_SYSTEM_PROMPT =
  "You write a weekly digest of a developer's work on one repository from that week's session summaries, " +
  "for a long-term memory graph. Answer with strict JSON only, no prose, no markdown fences.";

export function buildDigestPrompt(input: DigestInput): string {
  const sessions = input.sessions.map(s => `### ${s.startedAt.slice(0, 16)}${s.title ? ` — ${s.title}` : ""}\n${s.summary.trim()}`).join("\n\n");
  const decisions = input.decisions.length
    ? input.decisions.map(d => `- ${d.decidedAt.slice(0, 10)}: ${d.summary}${d.rationale ? ` — ${d.rationale}` : ""}`).join("\n")
    : "none";
  return [
    `Repo: ${input.repo}. Week ${input.week} (${input.periodStart.slice(0, 10)} to ${input.periodEnd.slice(0, 10)}), ${input.sessions.length} sessions.`,
    "",
    "SESSION SUMMARIES:",
    sessions,
    "",
    "DECISIONS RECORDED THIS WEEK:",
    decisions,
    "",
    "Return JSON with exactly this shape:",
    '{ "title": "<= 80 chars", "text": "markdown, <= 2000 chars, sections: **Shipped**, **Decided**, **Learned**, **Open**; keep commit ids, file paths and version numbers" }',
  ].join("\n");
}

/** Parse and validate a model response; returns null on anything that is not the expected shape. */
export function parseSessionRollup(raw: string): SessionRollup | null {
  const obj = parseJsonObject(raw);
  if (!obj) return null;
  const title = str(obj["title"], 120);
  const summary = str(obj["summary"], 4000);
  if (!title || !summary) return null;
  const decisions: SessionRollup["decisions"] = [];
  const list = Array.isArray(obj["decisions"]) ? obj["decisions"] : [];
  for (const d of list.slice(0, MAX_DECISIONS_PER_SESSION)) {
    if (!d || typeof d !== "object") continue;
    const rec = d as Record<string, unknown>;
    const s = str(rec["summary"], 300);
    if (!s) continue;
    const supersedes = Array.isArray(rec["supersedes"]) ? rec["supersedes"].filter((x): x is string => typeof x === "string" && x.length > 0) : [];
    decisions.push({ summary: s, rationale: str(rec["rationale"], 600) ?? "", supersedes });
  }
  return { title, summary, decisions };
}

export function parseDigest(raw: string): Digest | null {
  const obj = parseJsonObject(raw);
  if (!obj) return null;
  const title = str(obj["title"], 120);
  const text = str(obj["text"], 6000);
  if (!title || !text) return null;
  return { title, text };
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const v = JSON.parse(trimmed.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? (t.length > max ? t.slice(0, max) : t) : null;
}

/** ISO-8601 week key and bounds (Monday 00:00 UTC to next Monday 00:00 UTC) for an instant. */
export function isoWeek(date: Date): { key: string; start: Date; end: Date } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - day + 1);
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  const end = new Date(monday);
  end.setUTCDate(monday.getUTCDate() + 7);
  return { key: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`, start: monday, end };
}

export function digestId(repo: string, weekKey: string): string {
  return `${repo}:${weekKey}`;
}
