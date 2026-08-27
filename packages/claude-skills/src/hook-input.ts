import { readFileSync } from "node:fs";

export interface HookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  stop_hook_active?: boolean;
  source?: string;
  reason?: string;
}

const KEYS: (keyof HookInput)[] = [
  "session_id", "transcript_path", "cwd", "hook_event_name", "stop_hook_active", "source", "reason",
];

export function parseHookInput(raw: string): HookInput {
  if (!raw.trim()) return {};
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!obj || typeof obj !== "object") return {};
  const out: HookInput = {};
  for (const k of KEYS) {
    const v = (obj as Record<string, unknown>)[k];
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export function readHookInput(): HookInput {
  try {
    return parseHookInput(readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

/** True inside processes the plugin itself spawns (rollup LLM calls): every hook must exit at once. */
export function hooksDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env["ARCADEDB_HOOKS"] ?? "").toLowerCase() === "off";
}
