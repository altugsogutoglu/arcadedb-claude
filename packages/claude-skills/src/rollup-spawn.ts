import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./env-paths.js";
import { runnerPath, runnerArgv } from "./index-spawn.js";

/** Detach a rollup-runner for `db`. Exits at once when no ended session or week is pending. */
export function spawnRollupRunner(args: { db: string; runner?: string }): number | null {
  try {
    const runner = args.runner ?? runnerPath("rollup-runner");
    const log = openSync(join(configDir(), "rollup.log"), "a");
    const argv = runnerArgv(runner, ["--db", args.db]);
    const child = spawn(process.execPath, argv, { detached: true, stdio: ["ignore", log, log], env: process.env });
    closeSync(log);
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  }
}
