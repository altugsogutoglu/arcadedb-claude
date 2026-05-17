import { readFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";

export interface TsconfigPaths {
  /** Relative to project root, e.g. "frontend/apps/fleet". */
  configDir: string;
  /** Resolved relative to configDir. Defaults to "." if baseUrl not set. */
  baseUrl: string;
  /** e.g. { "@/*": ["./src/*"] } as written in tsconfig. */
  paths: Record<string, string[]>;
}

/**
 * Discover every tsconfig.json among the walked files. Reads each, extracts
 * baseUrl + paths from compilerOptions. Returns a map keyed by configDir
 * (relative to project root). Files that fail to parse are silently skipped.
 *
 * Stripping JSON-with-comments support is intentional: tsconfig files routinely
 * include // comments and trailing commas. We do a minimal cleanup; if JSON.parse
 * still fails, the config is skipped (rare in practice).
 */
export async function findTsconfigs(
  projectRoot: string,
  walkedFiles: string[],
): Promise<Map<string, TsconfigPaths>> {
  const out = new Map<string, TsconfigPaths>();
  const tsconfigFiles = walkedFiles.filter(f => f.endsWith("tsconfig.json"));
  for (const rel of tsconfigFiles) {
    try {
      const text = await readFile(join(projectRoot, rel), "utf8");
      const cleaned = stripJsonComments(text);
      const parsed = JSON.parse(cleaned);
      const co = parsed?.compilerOptions ?? {};
      const paths = co.paths;
      if (!paths || typeof paths !== "object") continue;
      const baseUrl = typeof co.baseUrl === "string" ? co.baseUrl : ".";
      const configDir = posix.dirname(rel);
      out.set(configDir, { configDir, baseUrl, paths });
    } catch {
      // skip unparseable configs
    }
  }
  return out;
}

/**
 * Walk up from the importing file's directory to find the nearest tsconfig
 * with paths defined.
 */
export function tsconfigForFile(
  importingFile: string,
  configs: Map<string, TsconfigPaths>,
): TsconfigPaths | null {
  let dir = posix.dirname(importingFile);
  while (true) {
    const c = configs.get(dir);
    if (c) return c;
    const parent = posix.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve a path-aliased import spec like "@/components/Button" against a
 * tsconfig's paths. Returns the path relative to project root, without
 * extension. Caller still needs to append .ts/.tsx/.js/.jsx and check existence.
 */
export function resolveAlias(spec: string, config: TsconfigPaths): string | null {
  for (const [pattern, targets] of Object.entries(config.paths)) {
    if (!targets || !targets.length) continue;
    const target = targets[0]!;

    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -2);
      if (!spec.startsWith(prefix + "/") && spec !== prefix) continue;
      const rest = spec === prefix ? "" : spec.slice(prefix.length + 1);
      const targetBase = target.endsWith("/*") ? target.slice(0, -2) : target;
      const resolvedInConfig = posix.normalize(posix.join(targetBase, rest));
      return joinFromRoot(config, resolvedInConfig);
    }

    if (pattern === spec) {
      return joinFromRoot(config, target);
    }
  }
  return null;
}

function joinFromRoot(config: TsconfigPaths, pathInsideConfig: string): string {
  const cleaned = pathInsideConfig.replace(/^\.\//, "");
  const baseUrl = config.baseUrl.replace(/^\.\//, "");
  const inProject = posix.normalize(posix.join(config.configDir, baseUrl, cleaned));
  return inProject;
}

function stripJsonComments(text: string): string {
  // Remove // line comments and /* block */ comments while preserving strings.
  // Good enough for tsconfig.json — not a full JSON-with-comments parser.
  let out = "";
  let i = 0;
  let inString = false;
  let stringChar = "";
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\" && next) { out += next; i += 2; continue; }
      if (ch === stringChar) inString = false;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; stringChar = ch!; out += ch; i++; continue; }
    if (ch === "/" && next === "/") { while (i < text.length && text[i] !== "\n") i++; continue; }
    if (ch === "/" && next === "*") { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++; i += 2; continue; }
    out += ch;
    i++;
  }
  // Remove trailing commas before } or ]
  return out.replace(/,(\s*[}\]])/g, "$1");
}
