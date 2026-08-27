import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import type { Psr4Map } from "./path.js";

export interface ComposerPsr4 {
  /** Relative to project root, e.g. "backend". */
  composerDir: string;
  /** Composed map where each path is project-root-relative. */
  psr4: Psr4Map;
}

/**
 * Discover every composer.json among the walked files. Reads each, extracts
 * autoload.psr-4 and autoload-dev.psr-4, and rebases each target path so it's
 * project-root-relative rather than composer-dir-relative.
 *
 * Returns a map keyed by composerDir.
 */
export async function findComposers(
  projectRoot: string,
  walkedFiles: string[],
): Promise<Map<string, ComposerPsr4>> {
  const out = new Map<string, ComposerPsr4>();
  const composerFiles = walkedFiles.filter(f => f.endsWith("composer.json"));
  for (const rel of composerFiles) {
    try {
      const text = await readFile(join(projectRoot, rel), "utf8");
      const parsed = JSON.parse(text);
      const psr4Raw: Record<string, string | string[]> = {
        ...(parsed?.autoload?.["psr-4"] ?? {}),
        ...(parsed?.["autoload-dev"]?.["psr-4"] ?? {}),
      };
      const composerDir = posix.dirname(rel);
      const psr4: Psr4Map = {};
      for (const [ns, target] of Object.entries(psr4Raw)) {
        const path = Array.isArray(target) ? target[0] : target;
        if (typeof path !== "string") continue;
        const cleaned = path.replace(/\/$/, "");
        const fromRoot = composerDir === "."
          ? cleaned
          : posix.normalize(posix.join(composerDir, cleaned));
        psr4[ns] = `${fromRoot}/`;
      }
      if (Object.keys(psr4).length > 0) out.set(composerDir, { composerDir, psr4 });
    } catch {
      // skip unparseable composer.json
    }
  }
  return out;
}

/**
 * Walk up from the importing file's directory to find the nearest composer.json.
 */
export function composerForFile(
  importingFile: string,
  composers: Map<string, ComposerPsr4>,
): ComposerPsr4 | null {
  let dir = posix.dirname(importingFile);
  while (true) {
    const c = composers.get(dir);
    if (c) return c;
    const parent = posix.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
