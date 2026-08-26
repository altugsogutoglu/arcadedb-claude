import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configDir } from "./env-paths.js";

export function runnerPath(): string {
  const root = process.env["CLAUDE_PLUGIN_ROOT"];
  if (root) return join(root, "hooks", "index.js");
  const here = fileURLToPath(import.meta.url);
  // Bundled: hooks/session-start.js -> hooks/index.js. Source (tests via tsx): src/index-spawn.ts -> run src/index-runner.ts through tsx.
  return here.endsWith(".ts") ? join(dirname(here), "index-runner.ts") : join(dirname(here), "index.js");
}

export function spawnIndexer(args: { root: string; db: string; key: string; stack: string[]; runner?: string }): number | null {
  try {
    const runner = args.runner ?? runnerPath();
    const log = openSync(join(configDir(), `index-${args.key}.log`), "a");
    const argv = runner.endsWith(".ts")
      ? [createRequire(import.meta.url).resolve("tsx/cli"), runner]
      : [runner];
    argv.push("--root", args.root, "--db", args.db, "--key", args.key);
    if (args.stack.length) argv.push("--stack", args.stack.join(","));
    const child = spawn(process.execPath, argv, { detached: true, stdio: ["ignore", log, log], env: process.env });
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  }
}
