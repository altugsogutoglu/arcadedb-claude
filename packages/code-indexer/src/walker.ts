import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const DEFAULT_EXCLUDES = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "vendor",
  "build",
  "coverage",
  ".turbo",
  ".cache",
]);

export interface WalkOptions {
  excludes?: Set<string>;
}

export async function walkRepo(root: string, options: WalkOptions = {}): Promise<string[]> {
  const excludes = options.excludes ?? DEFAULT_EXCLUDES;
  const out: string[] = [];
  await walk(root, root, excludes, out);
  out.sort();
  return out;
}

async function walk(root: string, dir: string, excludes: Set<string>, out: string[]): Promise<void> {
  const entries = await readdir(dir);
  for (const entry of entries) {
    if (excludes.has(entry)) continue;
    const full = join(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) {
      await walk(root, full, excludes, out);
    } else if (s.isFile()) {
      out.push(relative(root, full));
    }
  }
}
