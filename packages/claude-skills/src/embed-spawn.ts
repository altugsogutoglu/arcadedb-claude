import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./env-paths.js";
import { runnerPath, runnerArgv } from "./index-spawn.js";

/** Detach an embed-runner for `db`. Cheap when nothing is pending: the runner exits at once. */
export function spawnEmbedRunner(args: { db: string; runner?: string }): number | null {
  try {
    const runner = args.runner ?? runnerPath("embed-runner");
    const log = openSync(join(configDir(), "embed.log"), "a");
    const argv = runnerArgv(runner, ["--db", args.db]);
    const child = spawn(process.execPath, argv, { detached: true, stdio: ["ignore", log, log], env: process.env });
    closeSync(log);
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  }
}
