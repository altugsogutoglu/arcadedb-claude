import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Client, applySchemas } from "arcadedb-agent-memory";
import { walkRepo, DEFAULT_EXCLUDES } from "./walker.js";
import { detectLanguage } from "./languages.js";
import { detectModule } from "./modules.js";
import { parseTsImports } from "./parsers/ts-imports.js";
import { parsePhpImports } from "./parsers/php-imports.js";
import { resolveRelative, resolvePsr4, type Psr4Map } from "./resolvers/path.js";
import { upsertRepo, upsertModule, upsertFile, linkContains, linkImports } from "./writer.js";

export interface IndexOptions {
  db: string;
  autoMigrate?: boolean;
  psr4?: Psr4Map;
  stack?: string;
  /** Extra directory names to exclude on top of DEFAULT_EXCLUDES. */
  extraExcludes?: string[];
  /** If true, skip DEFAULT_EXCLUDES entirely and use only `extraExcludes`. */
  noDefaultExcludes?: boolean;
}

export interface IndexSummary {
  repo: string;
  files: number;
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

  const psr4 = options.psr4 ?? defaultPsr4(repoName);

  await upsertRepo(client, options.db, {
    name: repoName,
    path: root,
    stack: options.stack ?? "unknown",
  });

  const excludes = new Set(options.noDefaultExcludes ? [] : DEFAULT_EXCLUDES);
  for (const e of options.extraExcludes ?? []) excludes.add(e);
  const files = await walkRepo(root, { excludes });

  const fileLanguages = new Map<string, "ts" | "js" | "php" | "other">();
  const moduleNames = new Set<string>();

  for (const rel of files) {
    const lang = detectLanguage(rel);
    fileLanguages.set(rel, lang);
    if (lang === "other") continue;

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
        ? resolvePsr4(spec, psr4)
        : resolveRelativeToFile(rel, spec, knownFiles);

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

  return { repo: repoName, files: files.length, imports: importsCount, unresolved: unresolvedCount };
}

function resolveRelativeToFile(fromFile: string, spec: string, known: Set<string>): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolveRelative(fromFile, spec);
  const exts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
  if (known.has(base)) return base;
  for (const ext of exts) {
    const candidate = `${base}${ext}`;
    if (known.has(candidate)) return candidate;
  }
  return null;
}

function defaultPsr4(_repoName: string): Psr4Map {
  return { "App\\": "app/" };
}
