import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Client, applySchemas } from "arcadedb-agent-memory";
import { walkRepo, DEFAULT_EXCLUDES } from "./walker.js";
import { detectLanguage } from "./languages.js";
import { detectModule } from "./modules.js";
import { parseTsImports } from "./parsers/ts-imports.js";
import { parsePhpImports } from "./parsers/php-imports.js";
import { resolveRelative, resolvePsr4, type Psr4Map } from "./resolvers/path.js";
import { findTsconfigs, tsconfigForFile, resolveAlias, type TsconfigPaths } from "./resolvers/tsconfig.js";
import { findComposers, composerForFile, type ComposerPsr4 } from "./resolvers/composer.js";
import { upsertRepo, upsertModule, upsertFile, linkContains, linkImports } from "./writer.js";

export interface IndexOptions {
  db: string;
  autoMigrate?: boolean;
  /** Override PSR-4 map for PHP imports. Defaults to auto-detected from composer.json files. */
  psr4?: Psr4Map;
  stack?: string;
  /** Extra directory names to exclude on top of DEFAULT_EXCLUDES. */
  extraExcludes?: string[];
  /** If true, skip DEFAULT_EXCLUDES entirely and use only `extraExcludes`. */
  noDefaultExcludes?: boolean;
}

export interface IndexSummary {
  repo: string;
  /** Number of source files written to the graph (excludes non-source like images, lockfiles). */
  files: number;
  /** Total files walked, including non-source. */
  totalFiles: number;
  imports: number;
  unresolved: number;
}

export async function indexRepo(
  client: Client,
  rootAbsPath: string,
  options: IndexOptions,
): Promise<IndexSummary> {
  const root = resolve(rootAbsPath);
  const repoName = basename(root);

  if (options.autoMigrate) {
    await applySchemas(client, options.db, ["core", "code"]);
  }

  await upsertRepo(client, options.db, {
    name: repoName,
    path: root,
    stack: options.stack ?? "unknown",
  });

  const excludes = new Set(options.noDefaultExcludes ? [] : DEFAULT_EXCLUDES);
  for (const e of options.extraExcludes ?? []) excludes.add(e);
  const files = await walkRepo(root, { excludes });

  const tsconfigs = await findTsconfigs(root, files);
  const composers = await findComposers(root, files);

  const fileLanguages = new Map<string, "ts" | "js" | "php" | "other">();
  const moduleNames = new Set<string>();
  let indexedFileCount = 0;

  for (const rel of files) {
    const lang = detectLanguage(rel);
    fileLanguages.set(rel, lang);
    if (lang === "other") continue;
    indexedFileCount++;

    const fullPath = join(root, rel);
    const source = await readFile(fullPath, "utf8");
    const loc = source.split("\n").length;
    const repoQualified = `${repoName}/${rel}`;

    await upsertFile(client, options.db, {
      path: repoQualified,
      language: lang,
      loc,
    });

    const moduleName = detectModule(rel);
    const moduleQualified = `${repoName}/${moduleName}`;
    if (!moduleNames.has(moduleQualified)) {
      await upsertModule(client, options.db, {
        name: moduleName,
        path: moduleQualified,
        language: lang,
      });
      await linkContains(client, options.db, "Repo", { name: repoName }, "Module", { path: moduleQualified });
      moduleNames.add(moduleQualified);
    }
    await linkContains(
      client, options.db,
      "Module", { path: moduleQualified },
      "File", { path: repoQualified },
    );
  }

  const knownFiles = new Set(fileLanguages.keys());

  let importsCount = 0;
  let unresolvedCount = 0;
  for (const rel of files) {
    const lang = fileLanguages.get(rel)!;
    if (lang === "other") continue;
    const fullPath = join(root, rel);
    const source = await readFile(fullPath, "utf8");
    const specs = lang === "php" ? parsePhpImports(source) : parseTsImports(source);
    const repoQualified = `${repoName}/${rel}`;

    for (const spec of specs) {
      const resolved = lang === "php"
        ? resolvePhpImport(spec, rel, composers, options.psr4, knownFiles)
        : resolveTsImport(spec, rel, tsconfigs, knownFiles);

      if (resolved && knownFiles.has(resolved)) {
        const targetQualified = `${repoName}/${resolved}`;
        await linkImports(client, options.db, repoQualified, targetQualified);
        importsCount++;
      } else {
        await linkImports(client, options.db, repoQualified, null, spec);
        unresolvedCount++;
      }
    }
  }

  return {
    repo: repoName,
    files: indexedFileCount,
    totalFiles: files.length,
    imports: importsCount,
    unresolved: unresolvedCount,
  };
}

function resolveTsImport(
  spec: string,
  fromFile: string,
  tsconfigs: Map<string, TsconfigPaths>,
  known: Set<string>,
): string | null {
  // Try path alias resolution first (handles "@/components/Button")
  if (!spec.startsWith(".")) {
    const tsconfig = tsconfigForFile(fromFile, tsconfigs);
    if (tsconfig) {
      const aliased = resolveAlias(spec, tsconfig);
      if (aliased) {
        const found = resolveWithExtensions(aliased, known);
        if (found) return found;
      }
    }
    return null;
  }
  // Fall back to relative resolution
  const base = resolveRelative(fromFile, spec);
  return resolveWithExtensions(base, known);
}

function resolveWithExtensions(base: string, known: Set<string>): string | null {
  const exts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
  if (known.has(base)) return base;
  for (const ext of exts) {
    const candidate = `${base}${ext}`;
    if (known.has(candidate)) return candidate;
  }
  // index files inside a dir
  for (const ext of exts) {
    const candidate = `${base}/index${ext}`;
    if (known.has(candidate)) return candidate;
  }
  return null;
}

function resolvePhpImport(
  spec: string,
  fromFile: string,
  composers: Map<string, ComposerPsr4>,
  override: Psr4Map | undefined,
  known: Set<string>,
): string | null {
  // Override map wins if provided (testing / explicit user config)
  if (override) {
    const candidate = resolvePsr4(spec, override);
    if (candidate && known.has(candidate)) return candidate;
  }
  const composer = composerForFile(fromFile, composers);
  if (!composer) return null;
  const candidate = resolvePsr4(spec, composer.psr4);
  if (candidate && known.has(candidate)) return candidate;
  return null;
}
