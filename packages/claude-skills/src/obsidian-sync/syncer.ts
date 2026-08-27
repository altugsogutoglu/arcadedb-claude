import { readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Client, applySchemas } from "../agent-memory/index.js";
import { walkVault } from "./walker.js";
import { parseFrontmatter } from "./frontmatter.js";
import { extractWikilinks } from "./wikilinks.js";
import { extractTags } from "./tags.js";
import { resolveTitle } from "./title.js";
import { upsertNote, upsertTag, linkLinksTo, linkTagged } from "./writer.js";

export interface SyncOptions {
  db: string;
  vaultName: string;
  autoMigrate?: boolean;
}

export interface SyncSummary {
  vault: string;
  notes: number;
  tags: number;
  resolvedLinks: number;
  unresolvedLinks: number;
}

export async function syncVault(
  client: Client,
  vaultRoot: string,
  options: SyncOptions,
): Promise<SyncSummary> {
  const root = resolve(vaultRoot);
  const vault = options.vaultName;

  if (options.autoMigrate) {
    await applySchemas(client, options.db, ["core", "notes"]);
  }

  const files = await walkVault(root);

  const parsed = new Map<string, { title: string; body: string; tags: string[]; wikilinks: string[]; createdAt: string; modifiedAt: string }>();
  const titleIndex = new Map<string, string>();

  for (const rel of files) {
    const full = join(root, rel);
    const source = await readFile(full, "utf8");
    const stats = await stat(full);
    const { frontmatter, body } = parseFrontmatter(source);
    const title = resolveTitle(rel, body, frontmatter);
    const tags = extractTags(body, frontmatter);
    const wikilinks = extractWikilinks(source);
    parsed.set(rel, {
      title, body,
      tags, wikilinks,
      createdAt: stats.birthtime.toISOString(),
      modifiedAt: stats.mtime.toISOString(),
    });
    titleIndex.set(basename(rel, ".md"), rel);
  }

  let tagCount = 0;
  const tagSet = new Set<string>();
  for (const rel of files) {
    const info = parsed.get(rel)!;
    const repoQualified = `${vault}/${rel}`;

    await upsertNote(client, options.db, {
      path: repoQualified,
      title: info.title,
      content: info.body,
      vault,
      createdAt: info.createdAt,
      modifiedAt: info.modifiedAt,
    });

    for (const tag of info.tags) {
      const key = `${vault}:${tag}`;
      if (!tagSet.has(key)) {
        await upsertTag(client, options.db, { name: tag, vault });
        tagSet.add(key);
        tagCount++;
      }
      await linkTagged(client, options.db, repoQualified, tag, vault);
    }
  }

  let resolvedLinks = 0;
  let unresolvedLinks = 0;
  for (const rel of files) {
    const info = parsed.get(rel)!;
    const fromQualified = `${vault}/${rel}`;
    for (const target of info.wikilinks) {
      const targetRel = resolveWikilink(target, titleIndex);
      if (targetRel) {
        await linkLinksTo(client, options.db, fromQualified, `${vault}/${targetRel}`);
        resolvedLinks++;
      } else {
        await linkLinksTo(client, options.db, fromQualified, null, target);
        unresolvedLinks++;
      }
    }
  }

  return { vault, notes: files.length, tags: tagCount, resolvedLinks, unresolvedLinks };
}

function resolveWikilink(target: string, titleIndex: Map<string, string>): string | null {
  if (target.includes("/")) {
    const withMd = target.endsWith(".md") ? target : `${target}.md`;
    if ([...titleIndex.values()].includes(withMd)) return withMd;
  }
  const name = target.includes("/") ? basename(target) : target;
  return titleIndex.get(name) ?? null;
}
