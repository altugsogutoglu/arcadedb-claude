import { existsSync, closeSync, openSync, statSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { configDir } from "./env-paths.js";
import { EMBEDDING_DIMENSIONS } from "./agent-memory/index.js";

export const EMBED_PACKAGE = "@xenova/transformers@2";
export const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
/** The model truncates at 256 tokens anyway; sending more is wasted work. */
export const EMBED_MAX_CHARS = 2000;

const INSTALL_STALE_MS = 30 * 60 * 1000;

/** Where the embedding runtime lives. Not inside the plugin: it is a 260 MB native install the marketplace cannot ship. */
export function embedDir(): string {
  return join(configDir(), "embed");
}

export function embedInstallLock(): string {
  return join(embedDir(), "install.lock");
}

export function isEmbedInstalled(dir: string = embedDir()): boolean {
  return existsSync(join(dir, "node_modules", "@xenova", "transformers", "package.json"));
}

export function isEmbedInstalling(lock: string = embedInstallLock(), now = Date.now()): boolean {
  try {
    return now - statSync(lock).mtimeMs < INSTALL_STALE_MS;
  } catch {
    return false;
  }
}

export type EmbedStatus = "ready" | "installing" | "missing";

export function embedStatus(dir: string = embedDir()): EmbedStatus {
  if (isEmbedInstalled(dir)) return "ready";
  return isEmbedInstalling(join(dir, "install.lock")) ? "installing" : "missing";
}

/**
 * Background `npm install` of the embedding runtime into embedDir().
 * Returns the pid, or null when already installed, already installing, or npm is unavailable.
 */
export function spawnEmbedInstall(dir: string = embedDir()): number | null {
  if (isEmbedInstalled(dir)) return null;
  const lock = join(dir, "install.lock");
  if (isEmbedInstalling(lock)) return null;
  try {
    mkdirSync(dir, { recursive: true });
    if (!existsSync(join(dir, "package.json"))) {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "arcadedb-embed", private: true }, null, 2) + "\n");
    }
    writeFileSync(lock, String(process.pid));
    const log = openSync(join(dir, "install.log"), "a");
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(npm, ["install", "--no-audit", "--no-fund", "--loglevel=error", EMBED_PACKAGE], {
      cwd: dir,
      detached: true,
      stdio: ["ignore", log, log],
      env: process.env,
    });
    closeSync(log);
    child.on("exit", () => { try { unlinkSync(lock); } catch { /* gone */ } });
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  }
}

export type Embedder = (texts: string[]) => Promise<number[][]>;

/**
 * Load transformers.js from embedDir() and return a mean-pooled, normalized embedder.
 * Throws when the runtime is not installed; callers decide whether to install or skip.
 */
export async function loadEmbedder(dir: string = embedDir()): Promise<Embedder> {
  if (!isEmbedInstalled(dir)) {
    throw new Error(`embedding runtime not installed in ${dir} (run: arcadedb-skills embed install)`);
  }
  const req = createRequire(join(dir, "package.json"));
  const entry = req.resolve("@xenova/transformers");
  const mod = (await import(pathToFileURL(entry).href)) as {
    pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<(input: string[], opts: Record<string, unknown>) => Promise<{ data: Float32Array; dims: number[] }>>;
    env: { cacheDir?: string; allowLocalModels?: boolean };
  };
  mod.env.cacheDir = join(dir, "models");
  mod.env.allowLocalModels = false;
  const pipe = await mod.pipeline("feature-extraction", EMBED_MODEL, { quantized: true });
  return async (texts: string[]) => {
    if (texts.length === 0) return [];
    const inputs = texts.map(t => (t.length > EMBED_MAX_CHARS ? t.slice(0, EMBED_MAX_CHARS) : t) || " ");
    const out = await pipe(inputs, { pooling: "mean", normalize: true });
    const dims = out.dims[out.dims.length - 1] ?? EMBEDDING_DIMENSIONS;
    const rows: number[][] = [];
    for (let i = 0; i < inputs.length; i++) {
      rows.push(Array.from(out.data.subarray(i * dims, (i + 1) * dims)));
    }
    return rows;
  };
}
