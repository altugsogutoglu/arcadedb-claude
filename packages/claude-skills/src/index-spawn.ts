import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configDir } from "./env-paths.js";

/**
 * Where the indexer entry point lives, given the module doing the asking.
 *  - plugin install: <CLAUDE_PLUGIN_ROOT>/hooks/index-runner.js
 *  - source (tests via tsx): src/index-spawn.ts -> src/index-runner.ts
 *  - hooks bundle: hooks/session-start.js -> hooks/index-runner.js (sibling)
 *  - tsc output: dist/src/index-spawn.js -> ../../hooks/index-runner.js
 */
export function resolveRunner(here: string, pluginRoot?: string, name = "index-runner"): string {
  if (pluginRoot) return join(pluginRoot, "hooks", `${name}.js`);
  if (here.endsWith(".ts")) return join(dirname(here), `${name}.ts`);
  const dir = dirname(here);
  // dist/src/*.js is compiled output; the runner bundle stays next to the other hooks.
  if (basename(dir) === "src" && basename(dirname(dir)) === "dist") {
    return join(dir, "..", "..", "hooks", `${name}.js`);
  }
  return join(dir, `${name}.js`);
}

export function runnerPath(name = "index-runner"): string {
  return resolveRunner(fileURLToPath(import.meta.url), process.env["CLAUDE_PLUGIN_ROOT"] || undefined, name);
}

/** Build the full argv for running `runner`, prefixing the tsx CLI when the runner is a .ts source file (under tsx, not bundled). */
export function runnerArgv(runner: string, args: string[]): string[] {
  const argv = runner.endsWith(".ts")
    ? [createRequire(import.meta.url).resolve("tsx/cli"), runner]
    : [runner];
  argv.push(...args);
  return argv;
}

export function spawnIndexer(args: { root: string; db: string; key: string; stack?: string[]; runner?: string }): number | null {
  try {
    const runner = args.runner ?? runnerPath();
    const log = openSync(join(configDir(), `index-${args.key}.log`), "a");
    const cmdArgs = ["--root", args.root, "--db", args.db, "--key", args.key];
    if (args.stack?.length) cmdArgs.push("--stack", args.stack.join(","));
    const argv = runnerArgv(runner, cmdArgs);
    const child = spawn(process.execPath, argv, { detached: true, stdio: ["ignore", log, log], env: process.env });
    closeSync(log);
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  }
}
