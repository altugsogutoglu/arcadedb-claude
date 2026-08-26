import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./env-paths.js";

export interface IndexNeed {
  needed: boolean;
  reason: "never_indexed" | "stale" | "fresh" | "auto_index_off";
  staleEdits: number;
}

export function stalePath(): string {
  return join(configDir(), "stale.log");
}

export function staleEditsSince(path: string, key: string, since: string | null): number {
  if (!existsSync(path)) return 0;
  const sinceMs = since ? new Date(since).getTime() : -Infinity;
  let n = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\[([^\]]+)\] (\S+) \(/.exec(line);
    if (!m || m[2] !== key) continue;
    if (new Date(m[1]!).getTime() > sinceMs) n++;
  }
  return n;
}

export function decideIndexNeed(
  entry: { lastIndexed: string | null },
  key: string,
  path: string,
  autoIndex: boolean,
): IndexNeed {
  if (!autoIndex) return { needed: false, reason: "auto_index_off", staleEdits: 0 };
  const staleEdits = staleEditsSince(path, key, entry.lastIndexed);
  if (entry.lastIndexed === null) return { needed: true, reason: "never_indexed", staleEdits };
  if (staleEdits > 0) return { needed: true, reason: "stale", staleEdits };
  return { needed: false, reason: "fresh", staleEdits: 0 };
}
