import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export const DEFAULT_EXCLUDES: ReadonlySet<string> = new Set([
  // Version control
  ".git",
  ".svn",
  ".hg",
  // Package managers
  "node_modules",
  "vendor",
  ".pnpm",
  ".yarn",
  // Build / dist outputs
  "dist",
  "build",
  "out",
  "target",
  "obj",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".docusaurus",
  // React Native / Expo native shells (mostly CocoaPods + Gradle, occasionally code)
  "ios",
  "android",
  ".expo",
  // Application logs
  "logs",
  // Caches
  "tmp",
  ".cache",
  ".turbo",
  ".parcel-cache",
  ".phpunit.cache",
  ".pytest_cache",
  "__pycache__",
  "coverage",
  ".nyc_output",
  // Editor / IDE
  ".idea",
  ".vscode",
  // User-archived code (common convention in monorepos)
  "archive",
  "archives",
]);

export interface WalkOptions {
  excludes?: Set<string>;
}

export async function walkRepo(root: string, options: WalkOptions = {}): Promise<string[]> {
  const excludes = options.excludes ?? new Set(DEFAULT_EXCLUDES);
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
