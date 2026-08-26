import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { captureLogPath } from "./env-paths.js";

export function logCapture(event: string, fields: Record<string, unknown> = {}): void {
  try {
    const path = captureLogPath();
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), event, ...fields }) + "\n");
  } catch {
    // logging must never break a hook
  }
}
