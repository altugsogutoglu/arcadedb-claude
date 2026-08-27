# obsidian-to-arcadedb v0.1.0 — Implementation Plan (Phase 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `obsidian-to-arcadedb` v0.1.0, a CLI that walks an Obsidian vault and writes :Note + :Tag nodes and :LINKS_TO + :TAGGED edges into an ArcadeDB graph.

**Architecture:** TypeScript library + CLI. One-shot import only (watch mode is v0.2). Uses `arcadedb-agent-memory`'s Client + the existing `notes` schema. Markdown parsing is regex-based: minimal YAML frontmatter parser, `[[wikilink]]` extractor, inline `#tag` extractor. Wikilink resolution by basename match across the vault.

**Tech Stack:** TypeScript 5.5+, Node 20+, vitest, tsx. No new runtime deps (no third-party markdown parser).

**Spec reference:** `arcadedb-agent-memory/docs/superpowers/specs/2026-05-17-arcadedb-suite-design.md` (§ Package 4).

**Working dir:** `~/projects/obsidian-to-arcadedb/` (substitute your local path).

**Prerequisites:**
- ArcadeDB running on `localhost:2480`
- `~/.config/arcadedb/.env` populated
- `arcadedb-agent-memory` v0.1.1+ sibling checkout, built (`dist/` exists)
- 4 DBs exist on the server: `claude_memory`, `project-a`, `project-b`, `project-c`

**Confidentiality:** Synthetic fixture vault only. No real note paths or content from the user's vaults. Use `project-a/b/c` placeholders in docs and README.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `vitest.config.ts`
- Create: `LICENSE`

- [ ] **Step 1: `package.json`**

```json
{
  "name": "obsidian-to-arcadedb",
  "version": "0.1.0",
  "description": "Sync an Obsidian vault into ArcadeDB as :Note nodes with [[wikilink]] edges. Phase 4 of the arcadedb-claude suite.",
  "license": "MIT",
  "type": "module",
  "main": "./dist/src/index.js",
  "types": "./dist/src/index.d.ts",
  "bin": {
    "obsidian-sync": "./dist/bin/obsidian-sync.js"
  },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsc -p tsconfig.json && chmod +x dist/bin/obsidian-sync.js",
    "test": "vitest run",
    "test:unit": "vitest run --exclude tests/writer.test.ts --exclude tests/syncer.test.ts --exclude 'tests/cli/**'",
    "test:watch": "vitest"
  },
  "engines": { "node": ">=20" },
  "dependencies": {
    "arcadedb-agent-memory": "file:../arcadedb-agent-memory"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/altugsogutoglu/obsidian-to-arcadedb.git"
  }
}
```

- [ ] **Step 2: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src/**/*", "bin/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: `.gitignore`**

```
node_modules/
dist/
.env
*.local.json
.DS_Store
coverage/
*.log
```

- [ ] **Step 4: `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/fixtures/**", "node_modules/**"],
    testTimeout: 20000,
    sequence: { concurrent: false }
  }
});
```

- [ ] **Step 5: `LICENSE`** (standard MIT, copyright 2026 Altug Sogutoglu)

- [ ] **Step 6: Install + smoke**

Run: `npm install && npx tsc --noEmit`
Expected: TS18003 (no src yet).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore vitest.config.ts LICENSE
git commit -m "chore: project scaffolding"
```

---

## Task 2: Test helpers + synthetic vault fixture

**Files:**
- Create: `tests/helpers/temp-db.ts`
- Create: `tests/fixtures/tiny-vault/Home.md`
- Create: `tests/fixtures/tiny-vault/Ideas.md`
- Create: `tests/fixtures/tiny-vault/Notes on Z.md`
- Create: `tests/fixtures/tiny-vault/Hub.md`
- Create: `tests/fixtures/tiny-vault/projects/Big Idea.md`

- [ ] **Step 1: Temp-db helper** at `tests/helpers/temp-db.ts`

```ts
import { loadEnv } from "arcadedb-agent-memory";

const env = loadEnv();

export interface TempDb {
  name: string;
  drop(): Promise<void>;
}

export async function createTempDb(prefix = "obsidian"): Promise<TempDb> {
  const name = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await fetch(`${env.httpUri}/api/v1/server`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: basic() },
    body: JSON.stringify({ command: `create database ${name}` }),
  });
  return {
    name,
    async drop() {
      await fetch(`${env.httpUri}/api/v1/server`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: basic() },
        body: JSON.stringify({ command: `drop database ${name}` }),
      });
    },
  };
}

function basic(): string {
  return "Basic " + Buffer.from(`${env.username}:${env.password}`).toString("base64");
}

export { env };
```

- [ ] **Step 2: Fixture: `tests/fixtures/tiny-vault/Home.md`**

```markdown
# Home

Welcome to the test vault. Start here.

See [[Ideas]] and [[Hub]] for more.
```

- [ ] **Step 3: Fixture: `tests/fixtures/tiny-vault/Ideas.md`**

```markdown
---
title: Idea Collection
tags: [planning, sketches]
---

Some ideas live here.

- Look at [[Hub]]
- Look at [[Big Idea]]

#brainstorm
```

- [ ] **Step 4: Fixture: `tests/fixtures/tiny-vault/Notes on Z.md`**

```markdown
Some prose about Z.

Inline #tag and another #observation in the body.

Links to [[Hub]].
```

- [ ] **Step 5: Fixture: `tests/fixtures/tiny-vault/Hub.md`**

```markdown
# Hub

Central note linked from many places.
```

- [ ] **Step 6: Fixture: `tests/fixtures/tiny-vault/projects/Big Idea.md`**

```markdown
---
tags:
  - project
  - active
---

# Big Idea

A project note in a nested folder.

Related: [[Ideas]].
```

- [ ] **Step 7: Commit**

```bash
git add tests/helpers/temp-db.ts tests/fixtures/
git commit -m "test: temp-db helper + tiny synthetic vault fixture"
```

---

## Task 3: Vault walker

**Files:**
- Create: `src/walker.ts`
- Test: `tests/walker.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { walkVault } from "../src/walker.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const vaultRoot = resolve(__dirname, "fixtures/tiny-vault");

describe("walkVault", () => {
  it("finds all 5 markdown files in the fixture vault", async () => {
    const files = await walkVault(vaultRoot);
    expect(files).toEqual(expect.arrayContaining([
      "Home.md",
      "Ideas.md",
      "Notes on Z.md",
      "Hub.md",
      "projects/Big Idea.md",
    ]));
    expect(files).toHaveLength(5);
  });

  it("excludes .obsidian, .git, and non-md files by default", async () => {
    const files = await walkVault(vaultRoot);
    expect(files.every(f => f.endsWith(".md"))).toBe(true);
    expect(files.every(f => !f.startsWith(".obsidian/"))).toBe(true);
    expect(files.every(f => !f.startsWith(".git/"))).toBe(true);
  });

  it("returns sorted relative paths", async () => {
    const files = await walkVault(vaultRoot);
    expect([...files].sort()).toEqual(files);
  });
});
```

- [ ] **Step 2: Verify fails**

Run: `npx vitest run tests/walker.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** at `src/walker.ts`

```ts
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const DEFAULT_EXCLUDES = new Set([".obsidian", ".git", ".trash", "node_modules", "attachments", "_attachments"]);

export interface WalkOptions {
  excludes?: Set<string>;
}

export async function walkVault(root: string, options: WalkOptions = {}): Promise<string[]> {
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
    } else if (s.isFile() && entry.endsWith(".md")) {
      out.push(relative(root, full));
    }
  }
}
```

- [ ] **Step 4: Verify passes**

Run: `npx vitest run tests/walker.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/walker.ts tests/walker.test.ts
git commit -m "feat: vault walker (.md only, exclude .obsidian/.git)"
```

---

## Task 4: Frontmatter parser

**Files:**
- Create: `src/frontmatter.ts`
- Test: `tests/frontmatter.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../src/frontmatter.js";

describe("parseFrontmatter", () => {
  it("returns empty frontmatter and full body when no frontmatter", () => {
    const r = parseFrontmatter("Just body content");
    expect(r.frontmatter).toEqual({});
    expect(r.body).toBe("Just body content");
  });

  it("extracts string fields", () => {
    const src = `---\ntitle: My Note\nauthor: Bob\n---\nbody`;
    const r = parseFrontmatter(src);
    expect(r.frontmatter["title"]).toBe("My Note");
    expect(r.frontmatter["author"]).toBe("Bob");
    expect(r.body).toBe("body");
  });

  it("extracts inline arrays", () => {
    const src = `---\ntags: [a, b, c]\n---\nbody`;
    const r = parseFrontmatter(src);
    expect(r.frontmatter["tags"]).toEqual(["a", "b", "c"]);
  });

  it("extracts dashed list arrays", () => {
    const src = `---\ntags:\n  - project\n  - active\n---\nbody`;
    const r = parseFrontmatter(src);
    expect(r.frontmatter["tags"]).toEqual(["project", "active"]);
  });

  it("handles values with surrounding quotes", () => {
    const src = `---\ntitle: "Quoted Title"\n---\nbody`;
    const r = parseFrontmatter(src);
    expect(r.frontmatter["title"]).toBe("Quoted Title");
  });

  it("strips the frontmatter block from the body", () => {
    const src = `---\ntitle: x\n---\nLine 1\nLine 2`;
    const r = parseFrontmatter(src);
    expect(r.body.startsWith("Line 1")).toBe(true);
  });
});
```

- [ ] **Step 2: Verify fails**

- [ ] **Step 3: Implement** at `src/frontmatter.ts`

```ts
export type FrontmatterValue = string | string[];

export interface Frontmatter {
  [key: string]: FrontmatterValue;
}

export interface ParsedNote {
  frontmatter: Frontmatter;
  body: string;
}

const FENCE_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

export function parseFrontmatter(source: string): ParsedNote {
  const m = source.match(FENCE_RE);
  if (!m) {
    return { frontmatter: {}, body: source };
  }
  const yaml = m[1] ?? "";
  const body = source.slice(m[0].length);
  return { frontmatter: parseYaml(yaml), body };
}

function parseYaml(input: string): Frontmatter {
  const out: Frontmatter = {};
  const lines = input.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const m = line.match(/^(\w[\w.-]*)\s*:\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1]!;
    const inlineValue = m[2]!.trim();

    if (inlineValue === "") {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const item = lines[j]!.match(/^\s*-\s+(.+)$/);
        if (!item) break;
        items.push(stripQuotes(item[1]!.trim()));
        j++;
      }
      if (items.length > 0) {
        out[key] = items;
        i = j;
        continue;
      }
    }

    if (inlineValue.startsWith("[") && inlineValue.endsWith("]")) {
      const inner = inlineValue.slice(1, -1);
      out[key] = inner.split(",").map(s => stripQuotes(s.trim())).filter(s => s.length > 0);
      i++;
      continue;
    }

    out[key] = stripQuotes(inlineValue);
    i++;
  }
  return out;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
```

- [ ] **Step 4: Verify passes** (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/frontmatter.ts tests/frontmatter.test.ts
git commit -m "feat: minimal YAML frontmatter parser"
```

---

## Task 5: Wikilink extractor

**Files:**
- Create: `src/wikilinks.ts`
- Test: `tests/wikilinks.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { extractWikilinks } from "../src/wikilinks.js";

describe("extractWikilinks", () => {
  it("extracts a simple wikilink", () => {
    expect(extractWikilinks("See [[Other Note]] for more.")).toEqual(["Other Note"]);
  });

  it("extracts multiple wikilinks", () => {
    expect(extractWikilinks("Read [[A]] and [[B]] and [[C]].")).toEqual(["A", "B", "C"]);
  });

  it("handles aliased wikilinks (target only, drop alias)", () => {
    expect(extractWikilinks("[[Real Note|display name]]")).toEqual(["Real Note"]);
  });

  it("handles folder-prefixed wikilinks (keep full path)", () => {
    expect(extractWikilinks("[[folder/Nested Note]]")).toEqual(["folder/Nested Note"]);
  });

  it("handles embed wikilinks (!![[..]])", () => {
    expect(extractWikilinks("![[Embedded Note]]")).toEqual(["Embedded Note"]);
  });

  it("returns empty array when no wikilinks", () => {
    expect(extractWikilinks("Plain text with no links.")).toEqual([]);
  });

  it("preserves order and deduplicates duplicates", () => {
    expect(extractWikilinks("[[A]] [[B]] [[A]]")).toEqual(["A", "B"]);
  });
});
```

- [ ] **Step 2: Verify fails**

- [ ] **Step 3: Implement** at `src/wikilinks.ts`

```ts
const WIKILINK_RE = /!?\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

export function extractWikilinks(source: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(source)) !== null) {
    const target = m[1]!.trim();
    if (!seen.has(target)) {
      seen.add(target);
      out.push(target);
    }
  }
  return out;
}
```

- [ ] **Step 4: Verify passes** (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/wikilinks.ts tests/wikilinks.test.ts
git commit -m "feat: wikilink extractor (handles aliases, embeds, folder paths)"
```

---

## Task 6: Tag extractor

**Files:**
- Create: `src/tags.ts`
- Test: `tests/tags.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { extractTags } from "../src/tags.js";

describe("extractTags", () => {
  it("extracts inline hash tags from body", () => {
    expect(extractTags("Some #idea and #another", {})).toEqual(["idea", "another"]);
  });

  it("dedupes inline tags", () => {
    expect(extractTags("#x #y #x", {})).toEqual(["x", "y"]);
  });

  it("combines frontmatter tags array with inline tags", () => {
    const tags = extractTags("inline #c", { tags: ["a", "b"] });
    expect(tags).toEqual(expect.arrayContaining(["a", "b", "c"]));
  });

  it("handles frontmatter tag as single string", () => {
    expect(extractTags("", { tags: "alpha" })).toEqual(["alpha"]);
  });

  it("ignores hash inside code spans (heuristic: skip lines starting with 4 spaces or backticks)", () => {
    const src = "    #not_a_tag\n\nreal #tag";
    expect(extractTags(src, {})).toEqual(["tag"]);
  });

  it("ignores hash followed by digits-only (markdown anchor link)", () => {
    expect(extractTags("[link](#123)", {})).toEqual([]);
  });

  it("returns empty array when no tags", () => {
    expect(extractTags("plain prose", {})).toEqual([]);
  });
});
```

- [ ] **Step 2: Verify fails**

- [ ] **Step 3: Implement** at `src/tags.ts`

```ts
import type { Frontmatter } from "./frontmatter.js";

const INLINE_TAG_RE = /(?:^|\s)#([\w-]*[A-Za-z_-][\w-]*)/g;

export function extractTags(body: string, frontmatter: Frontmatter): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const fmTags = frontmatter["tags"];
  if (fmTags) {
    const items = Array.isArray(fmTags) ? fmTags : [fmTags];
    for (const item of items) {
      const t = String(item).trim();
      if (t && !seen.has(t)) { seen.add(t); out.push(t); }
    }
  }

  const cleanedBody = stripCodeAndIndented(body);
  INLINE_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_TAG_RE.exec(cleanedBody)) !== null) {
    const tag = m[1]!;
    if (!seen.has(tag)) { seen.add(tag); out.push(tag); }
  }

  return out;
}

function stripCodeAndIndented(src: string): string {
  return src.split("\n")
    .filter(line => !line.startsWith("    ") && !line.startsWith("\t"))
    .join("\n");
}
```

The `INLINE_TAG_RE` requires at least one letter, underscore, or hyphen in the tag (so `#123` is skipped — anchor links to numeric IDs don't pollute the tag set). It allows alphanumerics plus underscore and hyphen everywhere else.

- [ ] **Step 4: Verify passes** (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tags.ts tests/tags.test.ts
git commit -m "feat: tag extractor (frontmatter + inline)"
```

---

## Task 7: Title resolver

**Files:**
- Create: `src/title.ts`
- Test: `tests/title.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { resolveTitle } from "../src/title.js";

describe("resolveTitle", () => {
  it("uses frontmatter title when present", () => {
    expect(resolveTitle("Notes on Z.md", "# H1\nbody", { title: "Custom Title" })).toBe("Custom Title");
  });

  it("falls back to first H1 when no frontmatter title", () => {
    expect(resolveTitle("Foo.md", "# Actual H1\nbody", {})).toBe("Actual H1");
  });

  it("falls back to filename (without .md) when no H1 or frontmatter", () => {
    expect(resolveTitle("Foo.md", "no heading", {})).toBe("Foo");
  });

  it("strips folder path from filename fallback", () => {
    expect(resolveTitle("subfolder/Foo.md", "no heading", {})).toBe("Foo");
  });

  it("trims whitespace from H1 content", () => {
    expect(resolveTitle("X.md", "#   Spaced H1   \nbody", {})).toBe("Spaced H1");
  });
});
```

- [ ] **Step 2: Verify fails**

- [ ] **Step 3: Implement** at `src/title.ts`

```ts
import { basename } from "node:path";
import type { Frontmatter } from "./frontmatter.js";

const H1_RE = /^#\s+(.+?)\s*$/m;

export function resolveTitle(relPath: string, body: string, frontmatter: Frontmatter): string {
  const fmTitle = frontmatter["title"];
  if (typeof fmTitle === "string" && fmTitle.trim().length > 0) {
    return fmTitle.trim();
  }
  const m = body.match(H1_RE);
  if (m) return m[1]!.trim();
  return basename(relPath, ".md");
}
```

- [ ] **Step 4: Verify passes** (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/title.ts tests/title.test.ts
git commit -m "feat: title resolver (frontmatter > H1 > filename)"
```

---

## Task 8: Writer (Notes + Tags) — integration

**Files:**
- Create: `src/writer.ts`
- Test: `tests/writer.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client, applySchemas } from "arcadedb-agent-memory";
import { upsertNote, upsertTag } from "../src/writer.js";
import { createTempDb, env, type TempDb } from "./helpers/temp-db.js";

let db: TempDb;
const client = new Client(env);

beforeAll(async () => {
  db = await createTempDb("notes-writer");
  await applySchemas(client, db.name, ["core", "notes"]);
});
afterAll(async () => { await db.drop(); });

describe("writer (notes/tags)", () => {
  it("upsertNote creates a :Note with the given path", async () => {
    await upsertNote(client, db.name, {
      path: "personal/Home.md",
      title: "Home",
      content: "Welcome",
      vault: "personal",
    });
    const rows = await client.query<{ "n.title": string; "n.vault": string }>(
      db.name, "cypher", "MATCH (n:Note {path: 'personal/Home.md'}) RETURN n.title, n.vault"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["n.title"]).toBe("Home");
    expect(rows[0]?.["n.vault"]).toBe("personal");
  });

  it("upsertNote is idempotent (no duplicate after second call)", async () => {
    await upsertNote(client, db.name, {
      path: "personal/Home.md",
      title: "Home",
      content: "Welcome again",
      vault: "personal",
    });
    const rows = await client.query<{ count: number }>(
      db.name, "cypher", "MATCH (n:Note {path: 'personal/Home.md'}) RETURN count(n) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("upsertTag creates a :Tag with composite (name, vault)", async () => {
    await upsertTag(client, db.name, { name: "idea", vault: "personal" });
    const rows = await client.query<{ "t.name": string; "t.vault": string }>(
      db.name, "cypher", "MATCH (t:Tag {name: 'idea', vault: 'personal'}) RETURN t.name, t.vault"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["t.name"]).toBe("idea");
  });

  it("upsertTag is idempotent on (name, vault)", async () => {
    await upsertTag(client, db.name, { name: "idea", vault: "personal" });
    const rows = await client.query<{ count: number }>(
      db.name, "cypher", "MATCH (t:Tag {name: 'idea', vault: 'personal'}) RETURN count(t) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("upsertTag with different vaults creates two distinct :Tag nodes for the same name", async () => {
    await upsertTag(client, db.name, { name: "shared", vault: "personal" });
    await upsertTag(client, db.name, { name: "shared", vault: "work" });
    const rows = await client.query<{ count: number }>(
      db.name, "cypher", "MATCH (t:Tag {name: 'shared'}) RETURN count(t) AS count"
    );
    expect(rows[0]?.count).toBe(2);
  });
});
```

- [ ] **Step 2: Verify fails**

- [ ] **Step 3: Implement** at `src/writer.ts`

```ts
import type { Client } from "arcadedb-agent-memory";

function q(s: string | number | undefined | null): string {
  if (s === undefined || s === null) return "null";
  if (typeof s === "number") return String(s);
  return `'${String(s).replace(/'/g, "\\'")}'`;
}

export interface NoteInput {
  path: string;
  title: string;
  content: string;
  vault: string;
  createdAt?: string;
  modifiedAt?: string;
}

export interface TagInput {
  name: string;
  vault: string;
}

export async function upsertNote(client: Client, db: string, note: NoteInput): Promise<void> {
  const now = new Date().toISOString();
  const cy = `
    MERGE (n:Note {path: ${q(note.path)}})
    SET n.title = ${q(note.title)},
        n.content = ${q(note.content)},
        n.vault = ${q(note.vault)},
        n.createdAt = datetime(${q(note.createdAt ?? now)}),
        n.modifiedAt = datetime(${q(note.modifiedAt ?? now)})
  `;
  await client.execute(db, "cypher", cy);
}

export async function upsertTag(client: Client, db: string, tag: TagInput): Promise<void> {
  const cy = `
    MERGE (t:Tag {name: ${q(tag.name)}, vault: ${q(tag.vault)}})
  `;
  await client.execute(db, "cypher", cy);
}
```

- [ ] **Step 4: Verify passes** (5 tests).

If "upsertTag with different vaults" fails because ArcadeDB's MERGE only matches on the first property, the workaround is to MERGE with a composite key string instead:

```ts
// alternative if multi-key MERGE doesn't work
const tagId = `${tag.vault}:${tag.name}`;
const cy = `
  MERGE (t:Tag {tagId: ${q(tagId)}})
  SET t.name = ${q(tag.name)}, t.vault = ${q(tag.vault)}
`;
```

That requires the schema to allow a `tagId` property, which it does since the schema doesn't restrict properties. Apply this fallback only if the original MERGE fails the multi-vault test.

- [ ] **Step 5: Commit**

```bash
git add src/writer.ts tests/writer.test.ts
git commit -m "feat: upsertNote + upsertTag"
```

---

## Task 9: Edge writer (LINKS_TO + TAGGED)

**Files:**
- Modify: `src/writer.ts` (append linkLinksTo + linkTagged)
- Modify: `tests/writer.test.ts` (append describe block)

- [ ] **Step 1: Append test** to `tests/writer.test.ts`

```ts
describe("writer (edges)", () => {
  it("linkLinksTo creates a :LINKS_TO edge between two notes", async () => {
    await upsertNote(client, db.name, { path: "personal/Ideas.md", title: "Ideas", content: "", vault: "personal" });
    await upsertNote(client, db.name, { path: "personal/Hub.md", title: "Hub", content: "", vault: "personal" });
    const { linkLinksTo } = await import("../src/writer.js");
    await linkLinksTo(client, db.name, "personal/Ideas.md", "personal/Hub.md");
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      "MATCH (a:Note {path: 'personal/Ideas.md'})-[:LINKS_TO]->(b:Note {path: 'personal/Hub.md'}) RETURN count(a) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("linkLinksTo is idempotent", async () => {
    const { linkLinksTo } = await import("../src/writer.js");
    await linkLinksTo(client, db.name, "personal/Ideas.md", "personal/Hub.md");
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      "MATCH (a:Note {path: 'personal/Ideas.md'})-[:LINKS_TO]->(b:Note {path: 'personal/Hub.md'}) RETURN count(a) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("linkTagged creates a :TAGGED edge from note to tag", async () => {
    const { linkTagged } = await import("../src/writer.js");
    await linkTagged(client, db.name, "personal/Ideas.md", "idea", "personal");
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      "MATCH (n:Note {path: 'personal/Ideas.md'})-[:TAGGED]->(t:Tag {name: 'idea', vault: 'personal'}) RETURN count(n) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("linkLinksTo records unresolved when target note does not exist", async () => {
    const { linkLinksTo } = await import("../src/writer.js");
    await linkLinksTo(client, db.name, "personal/Ideas.md", null, "Phantom Note");
    const rows = await client.query<{ "n.unresolvedLinks": string | null }>(
      db.name, "cypher",
      "MATCH (n:Note {path: 'personal/Ideas.md'}) RETURN n.unresolvedLinks"
    );
    const val = rows[0]?.["n.unresolvedLinks"] ?? "";
    expect(val.split(",").map(s => s.trim()).filter(Boolean)).toContain("Phantom Note");
  });
});
```

- [ ] **Step 2: Verify fails**

- [ ] **Step 3: Append impl** to `src/writer.ts`

```ts
export async function linkLinksTo(
  client: Client,
  db: string,
  fromPath: string,
  toPath: string | null,
  unresolvedTarget?: string,
): Promise<void> {
  if (toPath) {
    const cy = `
      MATCH (a:Note {path: ${q(fromPath)}})
      MATCH (b:Note {path: ${q(toPath)}})
      MERGE (a)-[:LINKS_TO]->(b)
    `;
    await client.execute(db, "cypher", cy);
    return;
  }
  if (unresolvedTarget) {
    const cy = `
      MATCH (n:Note {path: ${q(fromPath)}})
      SET n.unresolvedLinks = coalesce(n.unresolvedLinks, '') + ${q(unresolvedTarget + ',')}
    `;
    await client.execute(db, "cypher", cy);
  }
}

export async function linkTagged(
  client: Client,
  db: string,
  notePath: string,
  tagName: string,
  vault: string,
): Promise<void> {
  const cy = `
    MATCH (n:Note {path: ${q(notePath)}})
    MATCH (t:Tag {name: ${q(tagName)}, vault: ${q(vault)}})
    MERGE (n)-[:TAGGED]->(t)
  `;
  await client.execute(db, "cypher", cy);
}
```

- [ ] **Step 4: Verify passes** (9 tests total: 5 from Task 8 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/writer.ts tests/writer.test.ts
git commit -m "feat: :LINKS_TO + :TAGGED edges with unresolved fallback"
```

---

## Task 10: Orchestration — syncVault()

**Files:**
- Create: `src/syncer.ts`
- Create: `src/index.ts`

- [ ] **Step 1: Implement** at `src/syncer.ts`

```ts
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { Client, applySchemas } from "arcadedb-agent-memory";
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
```

- [ ] **Step 2: Public API** at `src/index.ts`

```ts
export { syncVault } from "./syncer.js";
export type { SyncOptions, SyncSummary } from "./syncer.js";
export { walkVault } from "./walker.js";
export { parseFrontmatter } from "./frontmatter.js";
export type { Frontmatter, FrontmatterValue, ParsedNote } from "./frontmatter.js";
export { extractWikilinks } from "./wikilinks.js";
export { extractTags } from "./tags.js";
export { resolveTitle } from "./title.js";
export {
  upsertNote, upsertTag, linkLinksTo, linkTagged,
  type NoteInput, type TagInput,
} from "./writer.js";
```

- [ ] **Step 3: Verify clean build**: `npx tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add src/syncer.ts src/index.ts
git commit -m "feat: syncVault orchestration + public API"
```

---

## Task 11: CLI — obsidian-sync

**Files:**
- Create: `bin/obsidian-sync.ts`

- [ ] **Step 1: Implement** at `bin/obsidian-sync.ts`

```ts
#!/usr/bin/env node
import { resolve, basename } from "node:path";
import { Client, loadEnv } from "arcadedb-agent-memory";
import { syncVault } from "../src/syncer.js";

const argv = process.argv.slice(2);
const [vaultArg, ...rest] = argv;

function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
}

function bool(name: string): boolean {
  return rest.includes(`--${name}`);
}

async function main(): Promise<number> {
  if (!vaultArg) {
    console.error("usage: obsidian-sync <vault-dir> --db <name> [--vault-name <label>] [--auto-migrate]");
    return 1;
  }
  const db = flag("db");
  if (!db) {
    console.error("error: --db <name> is required");
    return 1;
  }

  const vaultRoot = resolve(vaultArg);
  const vaultName = flag("vault-name") ?? basename(vaultRoot);

  const client = new Client(loadEnv());
  const summary = await syncVault(client, vaultRoot, {
    db,
    vaultName,
    autoMigrate: bool("auto-migrate"),
  });

  console.log(
    `synced ${summary.vault}: ${summary.notes} notes, ${summary.tags} tags, ${summary.resolvedLinks} links, ${summary.unresolvedLinks} unresolved`
  );
  return 0;
}

main().then(code => process.exit(code)).catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Verify build**: `npx tsc --noEmit`.

- [ ] **Step 3: Commit**

```bash
git add bin/obsidian-sync.ts
git commit -m "feat: obsidian-sync CLI"
```

---

## Task 12: End-to-end syncer test

**Files:**
- Test: `tests/syncer.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, applySchemas } from "arcadedb-agent-memory";
import { syncVault } from "../src/syncer.js";
import { createTempDb, env, type TempDb } from "./helpers/temp-db.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const vaultRoot = resolve(__dirname, "fixtures/tiny-vault");

let db: TempDb;
const client = new Client(env);

beforeAll(async () => {
  db = await createTempDb("e2e-vault");
  await applySchemas(client, db.name, ["core", "notes"]);
});
afterAll(async () => { await db.drop(); });

describe("syncVault on tiny-vault fixture", () => {
  it("produces a summary with the right counts", async () => {
    const summary = await syncVault(client, vaultRoot, { db: db.name, vaultName: "test-vault" });
    expect(summary.notes).toBe(5);
    expect(summary.tags).toBeGreaterThan(0);
    expect(summary.resolvedLinks).toBeGreaterThan(0);
  });

  it("creates all 5 :Note nodes with the vault label", async () => {
    const rows = await client.query<{ "n.path": string }>(
      db.name, "cypher",
      "MATCH (n:Note {vault: 'test-vault'}) RETURN n.path ORDER BY n.path"
    );
    expect(rows.map(r => r["n.path"])).toEqual([
      "test-vault/Home.md",
      "test-vault/Hub.md",
      "test-vault/Ideas.md",
      "test-vault/Notes on Z.md",
      "test-vault/projects/Big Idea.md",
    ]);
  });

  it("creates the resolved :LINKS_TO from Home.md to Hub.md", async () => {
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      "MATCH (a:Note {path: 'test-vault/Home.md'})-[:LINKS_TO]->(b:Note {path: 'test-vault/Hub.md'}) RETURN count(a) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("creates :LINKS_TO from Ideas.md to Big Idea.md (basename match across folders)", async () => {
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      "MATCH (a:Note {path: 'test-vault/Ideas.md'})-[:LINKS_TO]->(b:Note {path: 'test-vault/projects/Big Idea.md'}) RETURN count(a) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("creates :Tag nodes for both inline and frontmatter tags", async () => {
    const rows = await client.query<{ "t.name": string }>(
      db.name, "cypher",
      "MATCH (t:Tag {vault: 'test-vault'}) RETURN t.name ORDER BY t.name"
    );
    const names = rows.map(r => r["t.name"]);
    expect(names).toEqual(expect.arrayContaining(["planning", "sketches", "brainstorm", "tag", "observation", "project", "active"]));
  });

  it("creates :TAGGED edge from Ideas.md to 'planning' tag", async () => {
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      "MATCH (n:Note {path: 'test-vault/Ideas.md'})-[:TAGGED]->(t:Tag {name: 'planning'}) RETURN count(n) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });
});
```

- [ ] **Step 2: Verify passes** (6 tests).

- [ ] **Step 3: Commit**

```bash
git add tests/syncer.test.ts
git commit -m "test: end-to-end syncVault on tiny-vault fixture"
```

---

## Task 13: CLI integration test

**Files:**
- Test: `tests/cli/sync.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, applySchemas } from "arcadedb-agent-memory";
import { createTempDb, env, type TempDb } from "../helpers/temp-db.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const exec = promisify(execFile);
const vaultRoot = resolve(__dirname, "../fixtures/tiny-vault");

let db: TempDb;
const client = new Client(env);

beforeAll(async () => {
  db = await createTempDb("cli-sync");
  await applySchemas(client, db.name, ["core", "notes"]);
});
afterAll(async () => { await db.drop(); });

describe("CLI: obsidian-sync", () => {
  it("syncs a vault and prints a summary line", async () => {
    const { stdout } = await exec("./node_modules/.bin/tsx", [
      "bin/obsidian-sync.ts", vaultRoot,
      "--db", db.name,
      "--vault-name", "cli-test",
    ], { cwd: process.cwd() });
    expect(stdout).toMatch(/synced cli-test: 5 notes, \d+ tags, \d+ links, \d+ unresolved/);
  });

  it("--auto-migrate makes the CLI work against a fresh DB", async () => {
    const fresh = await createTempDb("cli-fresh");
    try {
      const { stdout } = await exec("./node_modules/.bin/tsx", [
        "bin/obsidian-sync.ts", vaultRoot,
        "--db", fresh.name,
        "--vault-name", "fresh-test",
        "--auto-migrate",
      ], { cwd: process.cwd() });
      expect(stdout).toMatch(/synced fresh-test/);
    } finally { await fresh.drop(); }
  });

  it("exits 1 when --db is missing", async () => {
    await expect(exec("./node_modules/.bin/tsx", ["bin/obsidian-sync.ts", vaultRoot])).rejects.toThrow();
  });
});
```

Using `./node_modules/.bin/tsx` directly (not `npx tsx`) to avoid the npm 11 PWD override issue caught in Phase 3.

- [ ] **Step 2: Verify passes** (3 tests).

- [ ] **Step 3: Commit**

```bash
git add tests/cli/sync.test.ts
git commit -m "test: CLI integration (sync + auto-migrate)"
```

---

## Task 14: CI workflow + README

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `README.md`

- [ ] **Step 1: CI** at `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  unit:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20, 22]
    steps:
      - uses: actions/checkout@v4
        with:
          repository: altugsogutoglu/arcadedb-agent-memory
          path: arcadedb-agent-memory
          ssh-key: ${{ secrets.SIBLING_REPO_DEPLOY_KEY }}
      - uses: actions/checkout@v4
        with:
          path: obsidian-to-arcadedb
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - name: build agent-memory
        working-directory: arcadedb-agent-memory
        run: npm install && npm run build
      - name: install bridge
        working-directory: obsidian-to-arcadedb
        run: npm install
      - name: typecheck
        working-directory: obsidian-to-arcadedb
        run: npx tsc --noEmit
      - name: unit tests (no DB)
        working-directory: obsidian-to-arcadedb
        run: npm run test:unit
```

- [ ] **Step 2: README** at `README.md`

```markdown
# obsidian-to-arcadedb

CLI that walks an Obsidian vault and writes its notes, tags, and wikilinks into an [ArcadeDB](https://arcadedb.com) graph. Phase 4 of the `arcadedb-claude` suite.

## Install

```bash
npm install -g obsidian-to-arcadedb
```

(Requires `arcadedb-agent-memory` and a running ArcadeDB on `localhost:2480`.)

## Usage

```bash
# Sync a vault into a DB. Assumes the DB has the schema applied.
obsidian-sync ~/notes --db claude_memory --vault-name personal

# Apply schema first if the DB is fresh.
obsidian-sync ~/notes --db claude_memory --vault-name personal --auto-migrate

# Default vault name is the basename of the vault dir.
obsidian-sync ~/notes --db claude_memory
```

## What it writes

- `:Note` nodes — one per `.md` file, with properties: `path`, `title`, `content`, `vault`, `createdAt`, `modifiedAt`
- `:Tag` nodes — one per unique `(name, vault)` pair
- `:LINKS_TO` edges — between notes (from `[[wikilinks]]`)
- `:TAGGED` edges — from notes to tags (inline `#tag` and frontmatter `tags:` array)

Unresolved wikilinks (target not found by basename match) are stored as a comma-separated `unresolvedLinks` property on the source note.

## How wikilinks resolve

For each `[[target]]`:
1. If target contains `/`, treat as a relative path inside the vault.
2. Otherwise, match by filename basename (without `.md`) anywhere in the vault.
3. If no match, store as unresolved.

Aliased wikilinks `[[real|alias]]` use `real` as the target. Embed wikilinks `![[note]]` are treated as regular links.

## How tags work

Tags come from two sources, both merged and deduplicated:
1. Frontmatter `tags:` field (array or single string).
2. Inline `#tag` mentions in the body. Tags must contain at least one letter, underscore, or hyphen (so `#123` markdown anchors are not extracted).

Indented lines (4 spaces or tab) are skipped as a heuristic for code blocks.

## Multi-vault support

Each `:Tag` node is keyed by `(name, vault)`. Running the sync twice with `--vault-name personal` and `--vault-name work` produces two distinct `:Tag {name: 'idea'}` nodes that can be queried separately.

## Limitations (v0.1.0)

- One-shot import only. Watch mode is v0.2.
- Regex-based markdown parsing. Edge cases like nested wikilinks in unusual syntax may be missed.
- Wikilink resolution is basename-only. If two notes share a name, both get linked.
- No incremental diff. Each run re-upserts everything.

## License

MIT
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "chore: CI workflow + README"
```

---

## Task 15: Final verification + v0.1.0 tag

- [ ] **Step 1: Build cleanly**

Run: `npm run build`
Expected: `dist/` created. `dist/bin/obsidian-sync.js` is chmod +x.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all tests pass. Rough count: 3 walker + 6 frontmatter + 7 wikilinks + 7 tags + 5 title + 9 writer + 6 syncer + 3 CLI = ~46 tests.

- [ ] **Step 3: Smoke test against claude_memory DB**

Apply schemas (if not already):
```bash
npx tsx -e "import { Client, loadEnv, applySchemas } from 'arcadedb-agent-memory'; const c = new Client(loadEnv()); await applySchemas(c, 'claude_memory', ['core', 'notes']); console.log('schemas ok');"
```

Sync the fixture vault into claude_memory:
```bash
npx tsx bin/obsidian-sync.ts tests/fixtures/tiny-vault --db claude_memory --vault-name smoke-vault
```

Expected: `synced smoke-vault: 5 notes, N tags, M links, K unresolved`.

Verify in Studio (`http://localhost:2480`):
```cypher
MATCH (n:Note {vault: 'smoke-vault'})-[:LINKS_TO]->(t:Note)
RETURN n.title AS from, t.title AS to ORDER BY from, to
```

Expected: rows showing Home→Hub, Home→Ideas, Ideas→Hub, Ideas→Big Idea, Notes on Z→Hub, Big Idea→Ideas.

- [ ] **Step 4: Tag**

```bash
git tag v0.1.0
```

Local only. Report tagged SHA.

- [ ] **Step 5: Status check**

Run: `git status` (expect clean).
Run: `git log --oneline -20`.

## Report back

For each step, brief result. End with:
- Build status
- Test count
- Smoke test outcome
- Tagged SHA
- Any follow-up
