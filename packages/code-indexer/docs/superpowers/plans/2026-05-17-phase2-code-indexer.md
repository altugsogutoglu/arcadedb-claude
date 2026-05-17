# arcadedb-code-indexer v0.1.0 — Implementation Plan (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `arcadedb-code-indexer` v0.1.0, a CLI that walks a TypeScript/JS or Laravel project and writes `:Repo / :Module / :File / :IMPORTS / :CONTAINS` to a graph DB.

**Architecture:** TypeScript library + CLI. Depends on `arcadedb-agent-memory` for schemas + Client. Walker reads the filesystem with `.gitignore` awareness, parsers extract imports via regex (not AST), resolver maps relative + PSR-4 paths, writer batches MERGE Cypher to the DB. Indexing is idempotent: running twice updates rather than duplicates.

**Tech Stack:** TypeScript 5.5+, Node 20+, vitest, tsx. Zero new runtime deps; integration tests reuse the Phase 1 Client.

**Spec reference:** `arcadedb-agent-memory/docs/superpowers/specs/2026-05-17-arcadedb-suite-design.md` (§ Package 2).

**Working dir:** `~/projects/arcadedb-code-indexer/` (substitute your local path)

**Prerequisites:**
- ArcadeDB container running on `localhost:2480`
- `~/.config/arcadedb/.env` populated (chmod 600)
- `arcadedb-agent-memory` checked out as a sibling at `~/projects/arcadedb-agent-memory/` and built (`npm run build` produced `dist/`)
- 4 DBs exist on the server: `claude_memory`, `project-a`, `project-b`, `project-c` (already created in Phase 1 prep)

**Confidentiality rule:** No real client names or absolute paths to client folders in any plan content, README, fixtures, or tests. Use `project-a`, `project-b`, `project-c` placeholders. Fixtures are synthetic.

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
  "name": "arcadedb-code-indexer",
  "version": "0.1.0",
  "description": "Walks a code repo and writes its structure (modules, files, imports) into an ArcadeDB graph. Phase 2 of the arcadedb-claude suite.",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "arcadedb-index": "./dist/bin/arcadedb-index.js"
  },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:unit": "vitest run --exclude tests/writer.test.ts --exclude tests/indexer.test.ts --exclude 'tests/cli/**'",
    "test:watch": "vitest",
    "cli": "tsx bin/arcadedb-index.ts"
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
    "url": "git+https://github.com/altugsogutoglu/arcadedb-code-indexer.git"
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

- [ ] **Step 5: `LICENSE`** (standard MIT, same text as Phase 1, copyright 2026 Altug Sogutoglu)

- [ ] **Step 6: Install + smoke check**

Run: `npm install`
Expected: installs vitest, tsx, typescript, and links arcadedb-agent-memory from the sibling repo.
Run: `npx tsc --noEmit`
Expected: TS18003 (no inputs yet) — same as Phase 1 Task 1. Will clear after Task 2.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore vitest.config.ts LICENSE
git commit -m "chore: project scaffolding"
```

---

## Task 2: Test helpers + synthetic fixtures

**Files:**
- Create: `tests/helpers/temp-db.ts`
- Create: `tests/fixtures/tiny-nextjs/` (5 files)
- Create: `tests/fixtures/tiny-laravel/` (3 files)

- [ ] **Step 1: Temp DB helper** at `tests/helpers/temp-db.ts`

```ts
import { loadEnv } from "arcadedb-agent-memory";

const env = loadEnv();

export interface TempDb {
  name: string;
  drop(): Promise<void>;
}

export async function createTempDb(prefix = "indexer"): Promise<TempDb> {
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

- [ ] **Step 2: Tiny Next.js fixture**

Create `tests/fixtures/tiny-nextjs/package.json`:

```json
{
  "name": "tiny-nextjs",
  "private": true
}
```

Create `tests/fixtures/tiny-nextjs/app/page.tsx`:

```tsx
import { Button } from "../components/Button";
import { getUsers } from "../lib/db";

export default async function Page() {
  const users = await getUsers();
  return <div><Button>Click</Button>{users.length}</div>;
}
```

Create `tests/fixtures/tiny-nextjs/app/api/users/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getUsers } from "../../../lib/db";
import { validateUser } from "../../../lib/validate";

export async function GET() {
  const users = await getUsers();
  return NextResponse.json(users);
}

export async function POST(req: Request) {
  const body = await req.json();
  validateUser(body);
  return NextResponse.json({ ok: true });
}
```

Create `tests/fixtures/tiny-nextjs/components/Button.tsx`:

```tsx
import { ReactNode } from "react";

export function Button({ children }: { children: ReactNode }) {
  return <button>{children}</button>;
}
```

Create `tests/fixtures/tiny-nextjs/lib/db.ts`:

```ts
export async function getUsers() {
  return [];
}
```

Create `tests/fixtures/tiny-nextjs/lib/validate.ts`:

```ts
export function validateUser(input: unknown): void {
  if (!input) throw new Error("invalid");
}
```

- [ ] **Step 3: Tiny Laravel fixture**

Create `tests/fixtures/tiny-laravel/composer.json`:

```json
{
  "name": "tiny/laravel",
  "autoload": { "psr-4": { "App\\": "app/" } }
}
```

Create `tests/fixtures/tiny-laravel/app/Http/Controllers/UserController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\AuthService;

class UserController
{
    public function index(AuthService $auth)
    {
        return User::all();
    }
}
```

Create `tests/fixtures/tiny-laravel/app/Models/User.php`:

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class User extends Model
{
    protected $table = 'users';
}
```

Create `tests/fixtures/tiny-laravel/app/Services/AuthService.php`:

```php
<?php

namespace App\Services;

use App\Models\User;

class AuthService
{
    public function findByEmail(string $email): ?User
    {
        return User::where('email', $email)->first();
    }
}
```

- [ ] **Step 4: Commit**

```bash
git add tests/helpers/temp-db.ts tests/fixtures/
git commit -m "test: temp-db helper + tiny-nextjs and tiny-laravel fixtures"
```

---

## Task 3: Filesystem walker

**Files:**
- Create: `src/walker.ts`
- Test: `tests/walker.test.ts`

- [ ] **Step 1: Failing test** at `tests/walker.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { walkRepo } from "../src/walker.js";

const nextjsRoot = resolve(__dirname, "fixtures/tiny-nextjs");
const laravelRoot = resolve(__dirname, "fixtures/tiny-laravel");

describe("walkRepo", () => {
  it("returns relative paths for source files in the next.js fixture", async () => {
    const files = await walkRepo(nextjsRoot);
    expect(files).toContain("app/page.tsx");
    expect(files).toContain("app/api/users/route.ts");
    expect(files).toContain("components/Button.tsx");
    expect(files).toContain("lib/db.ts");
    expect(files).toContain("lib/validate.ts");
  });

  it("excludes node_modules, .git, dist, .next by default", async () => {
    const files = await walkRepo(nextjsRoot);
    expect(files.every(f => !f.includes("node_modules"))).toBe(true);
    expect(files.every(f => !f.startsWith(".git/"))).toBe(true);
    expect(files.every(f => !f.startsWith("dist/"))).toBe(true);
    expect(files.every(f => !f.startsWith(".next/"))).toBe(true);
  });

  it("walks the laravel fixture", async () => {
    const files = await walkRepo(laravelRoot);
    expect(files).toContain("app/Http/Controllers/UserController.php");
    expect(files).toContain("app/Models/User.php");
    expect(files).toContain("app/Services/AuthService.php");
  });

  it("returns sorted relative paths", async () => {
    const files = await walkRepo(nextjsRoot);
    const sorted = [...files].sort();
    expect(files).toEqual(sorted);
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npx vitest run tests/walker.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** at `src/walker.ts`

```ts
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
```

- [ ] **Step 4: Run to verify passes**

Run: `npx vitest run tests/walker.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/walker.ts tests/walker.test.ts
git commit -m "feat: gitignore-aware filesystem walker"
```

---

## Task 4: Language detection

**Files:**
- Create: `src/languages.ts`
- Test: `tests/languages.test.ts`

- [ ] **Step 1: Failing test** at `tests/languages.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { detectLanguage } from "../src/languages.js";

describe("detectLanguage", () => {
  it("identifies TypeScript files", () => {
    expect(detectLanguage("app/page.tsx")).toBe("ts");
    expect(detectLanguage("lib/db.ts")).toBe("ts");
    expect(detectLanguage("types.d.ts")).toBe("ts");
  });

  it("identifies JavaScript files", () => {
    expect(detectLanguage("server.js")).toBe("js");
    expect(detectLanguage("next.config.mjs")).toBe("js");
    expect(detectLanguage("client.cjs")).toBe("js");
    expect(detectLanguage("App.jsx")).toBe("js");
  });

  it("identifies PHP files", () => {
    expect(detectLanguage("app/Models/User.php")).toBe("php");
  });

  it("returns 'other' for unknown extensions", () => {
    expect(detectLanguage("README.md")).toBe("other");
    expect(detectLanguage("package.json")).toBe("other");
    expect(detectLanguage("Dockerfile")).toBe("other");
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npx vitest run tests/languages.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** at `src/languages.ts`

```ts
export type Language = "ts" | "js" | "php" | "other";

const TS_EXT = new Set([".ts", ".tsx"]);
const JS_EXT = new Set([".js", ".jsx", ".mjs", ".cjs"]);
const PHP_EXT = new Set([".php"]);

export function detectLanguage(path: string): Language {
  const ext = extOf(path);
  if (TS_EXT.has(ext)) return "ts";
  if (JS_EXT.has(ext)) return "js";
  if (PHP_EXT.has(ext)) return "php";
  return "other";
}

function extOf(path: string): string {
  const i = path.lastIndexOf(".");
  if (i === -1) return "";
  return path.slice(i).toLowerCase();
}
```

- [ ] **Step 4: Run to verify passes**

Run: `npx vitest run tests/languages.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/languages.ts tests/languages.test.ts
git commit -m "feat: language detection by extension"
```

---

## Task 5: TypeScript/JavaScript import parser

**Files:**
- Create: `src/parsers/ts-imports.ts`
- Test: `tests/parsers/ts-imports.test.ts`

- [ ] **Step 1: Failing test** at `tests/parsers/ts-imports.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseTsImports } from "../../src/parsers/ts-imports.js";

describe("parseTsImports", () => {
  it("extracts named ESM imports", () => {
    const src = `import { foo, bar } from "./mod";`;
    expect(parseTsImports(src)).toEqual(["./mod"]);
  });

  it("extracts default imports", () => {
    const src = `import React from "react";`;
    expect(parseTsImports(src)).toEqual(["react"]);
  });

  it("extracts namespace imports", () => {
    const src = `import * as fs from "node:fs";`;
    expect(parseTsImports(src)).toEqual(["node:fs"]);
  });

  it("extracts side-effect imports", () => {
    const src = `import "./globals.css";`;
    expect(parseTsImports(src)).toEqual(["./globals.css"]);
  });

  it("extracts dynamic imports", () => {
    const src = `const m = await import("./lazy");`;
    expect(parseTsImports(src)).toEqual(["./lazy"]);
  });

  it("extracts CommonJS requires", () => {
    const src = `const x = require("./util");`;
    expect(parseTsImports(src)).toEqual(["./util"]);
  });

  it("returns multiple imports in source order", () => {
    const src = `import a from "a";\nimport b from "b";\nimport c from "c";`;
    expect(parseTsImports(src)).toEqual(["a", "b", "c"]);
  });

  it("returns empty array when there are no imports", () => {
    expect(parseTsImports(`const x = 1;`)).toEqual([]);
  });

  it("ignores imports inside string literals or comments", () => {
    const src = `// import { x } from "./fake";\nconst s = 'import a from \"b\"';`;
    expect(parseTsImports(src)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npx vitest run tests/parsers/ts-imports.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** at `src/parsers/ts-imports.ts`

```ts
const IMPORT_RE = /^\s*import\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gm;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const REQUIRE_RE = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

export function parseTsImports(source: string): string[] {
  const stripped = stripCommentsAndStrings(source);
  const out: { idx: number; spec: string }[] = [];
  for (const re of [IMPORT_RE, DYNAMIC_IMPORT_RE, REQUIRE_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
      out.push({ idx: m.index, spec: m[1]! });
    }
  }
  out.sort((a, b) => a.idx - b.idx);
  return out.map(x => x.spec);
}

function stripCommentsAndStrings(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += " ";
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\" && i + 1 < n) {
          i += 2;
          out += "  ";
          continue;
        }
        out += " ";
        i++;
      }
      i++;
      out += " ";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
```

Note on the stripper: the test asserts that an `import` inside a string literal or comment is NOT extracted. The implementation replaces strings/comments with spaces of the same length so positions are preserved for downstream tools. The dynamic-import and require regexes operate on the stripped source.

- [ ] **Step 4: Run to verify passes**

Run: `npx vitest run tests/parsers/ts-imports.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/parsers/ts-imports.ts tests/parsers/ts-imports.test.ts
git commit -m "feat: regex-based TS/JS import parser"
```

---

## Task 6: PHP import parser

**Files:**
- Create: `src/parsers/php-imports.ts`
- Test: `tests/parsers/php-imports.test.ts`

- [ ] **Step 1: Failing test** at `tests/parsers/php-imports.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parsePhpImports } from "../../src/parsers/php-imports.js";

describe("parsePhpImports", () => {
  it("extracts a single use statement", () => {
    const src = `<?php\nuse App\\Models\\User;\nclass X {}`;
    expect(parsePhpImports(src)).toEqual(["App\\Models\\User"]);
  });

  it("extracts multiple use statements", () => {
    const src = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\User;
use App\\Services\\AuthService;

class UserController {}`;
    expect(parsePhpImports(src)).toEqual([
      "App\\Models\\User",
      "App\\Services\\AuthService",
    ]);
  });

  it("extracts use with alias (keeps the FQN, drops 'as Alias')", () => {
    const src = `<?php\nuse App\\Models\\User as UserModel;`;
    expect(parsePhpImports(src)).toEqual(["App\\Models\\User"]);
  });

  it("extracts grouped use { A, B }", () => {
    const src = `<?php\nuse App\\Models\\{User, Post};`;
    expect(parsePhpImports(src)).toEqual([
      "App\\Models\\User",
      "App\\Models\\Post",
    ]);
  });

  it("returns empty array when no use statements", () => {
    expect(parsePhpImports(`<?php class X {}`)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npx vitest run tests/parsers/php-imports.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** at `src/parsers/php-imports.ts`

```ts
const SIMPLE_USE_RE = /^\s*use\s+([\w\\]+)(?:\s+as\s+\w+)?\s*;/gm;
const GROUPED_USE_RE = /^\s*use\s+([\w\\]+)\\\{\s*([^}]+)\}\s*;/gm;

export function parsePhpImports(source: string): string[] {
  const out: { idx: number; fqn: string }[] = [];

  GROUPED_USE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = GROUPED_USE_RE.exec(source)) !== null) {
    const base = m[1]!;
    const parts = m[2]!.split(",").map(s => s.trim()).filter(Boolean);
    let offset = 0;
    for (const part of parts) {
      const fqn = `${base}\\${part.split(/\s+as\s+/i)[0]!.trim()}`;
      out.push({ idx: m.index + offset, fqn });
      offset++;
    }
  }

  SIMPLE_USE_RE.lastIndex = 0;
  while ((m = SIMPLE_USE_RE.exec(source)) !== null) {
    if (/\\\{/.test(m[0])) continue;
    out.push({ idx: m.index, fqn: m[1]! });
  }

  out.sort((a, b) => a.idx - b.idx);
  return out.map(x => x.fqn);
}
```

Note: `\\\{` in the JS regex source matches the literal `\{` sequence in PHP source code (grouped-use syntax). The SIMPLE_USE_RE check skips lines containing `\{` so grouped uses are not double-counted.

- [ ] **Step 4: Run to verify passes**

Run: `npx vitest run tests/parsers/php-imports.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/parsers/php-imports.ts tests/parsers/php-imports.test.ts
git commit -m "feat: regex-based PHP use-statement parser"
```

---

## Task 7: Path resolver (relative + PSR-4)

**Files:**
- Create: `src/resolvers/path.ts`
- Test: `tests/resolvers/path.test.ts`

- [ ] **Step 1: Failing test** at `tests/resolvers/path.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { resolveRelative, resolvePsr4 } from "../../src/resolvers/path.js";

describe("resolveRelative", () => {
  it("resolves ./sibling to a sibling file", () => {
    const result = resolveRelative("app/page.tsx", "./layout");
    expect(result).toBe("app/layout");
  });

  it("resolves ../parent into the parent dir", () => {
    const result = resolveRelative("app/api/users/route.ts", "../../../lib/db");
    expect(result).toBe("lib/db");
  });

  it("returns the spec as-is for bare package imports", () => {
    expect(resolveRelative("app/page.tsx", "react")).toBe("react");
    expect(resolveRelative("app/page.tsx", "next/server")).toBe("next/server");
  });

  it("returns the spec as-is for alias imports (@/...)", () => {
    expect(resolveRelative("app/page.tsx", "@/lib/db")).toBe("@/lib/db");
  });
});

describe("resolvePsr4", () => {
  it("maps App\\Models\\User to app/Models/User.php", () => {
    const map = { "App\\": "app/" };
    expect(resolvePsr4("App\\Models\\User", map)).toBe("app/Models/User.php");
  });

  it("maps a deeply nested namespace", () => {
    const map = { "App\\": "app/" };
    expect(resolvePsr4("App\\Http\\Controllers\\UserController", map))
      .toBe("app/Http/Controllers/UserController.php");
  });

  it("returns null for FQNs that do not match any prefix", () => {
    const map = { "App\\": "app/" };
    expect(resolvePsr4("Illuminate\\Database\\Eloquent\\Model", map)).toBeNull();
  });

  it("matches the longest prefix when multiple apply", () => {
    const map = { "App\\": "app/", "App\\Http\\": "src/http/" };
    expect(resolvePsr4("App\\Http\\Controllers\\UserController", map))
      .toBe("src/http/Controllers/UserController.php");
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npx vitest run tests/resolvers/path.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** at `src/resolvers/path.ts`

```ts
import { dirname, join, normalize, posix } from "node:path";

export function resolveRelative(fromFile: string, spec: string): string {
  if (!spec.startsWith(".")) return spec;
  const fromDir = posix.dirname(fromFile);
  const joined = posix.normalize(posix.join(fromDir, spec));
  return joined;
}

export type Psr4Map = Record<string, string>;

export function resolvePsr4(fqn: string, map: Psr4Map): string | null {
  const sortedPrefixes = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const prefix of sortedPrefixes) {
    if (fqn.startsWith(prefix)) {
      const rest = fqn.slice(prefix.length).replace(/\\/g, "/");
      return `${map[prefix]}${rest}.php`;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run to verify passes**

Run: `npx vitest run tests/resolvers/path.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/resolvers/path.ts tests/resolvers/path.test.ts
git commit -m "feat: relative + PSR-4 path resolvers"
```

---

## Task 8: Module detection

**Files:**
- Create: `src/modules.ts`
- Test: `tests/modules.test.ts`

- [ ] **Step 1: Failing test** at `tests/modules.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { detectModule } from "../src/modules.js";

describe("detectModule", () => {
  it("groups Next.js app dir files under the 'app' module", () => {
    expect(detectModule("app/page.tsx")).toBe("app");
    expect(detectModule("app/api/users/route.ts")).toBe("app");
  });

  it("groups components/* under 'components'", () => {
    expect(detectModule("components/Button.tsx")).toBe("components");
  });

  it("groups lib/* under 'lib'", () => {
    expect(detectModule("lib/db.ts")).toBe("lib");
    expect(detectModule("lib/validate.ts")).toBe("lib");
  });

  it("groups Laravel app/Http/* under 'Http'", () => {
    expect(detectModule("app/Http/Controllers/UserController.php")).toBe("Http");
  });

  it("groups Laravel app/Models/* under 'Models'", () => {
    expect(detectModule("app/Models/User.php")).toBe("Models");
  });

  it("groups Laravel app/Services/* under 'Services'", () => {
    expect(detectModule("app/Services/AuthService.php")).toBe("Services");
  });

  it("returns 'root' for files at the top level", () => {
    expect(detectModule("README.md")).toBe("root");
    expect(detectModule("vite.config.ts")).toBe("root");
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npx vitest run tests/modules.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** at `src/modules.ts`

```ts
export function detectModule(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  if (parts.length === 1) return "root";
  if (parts[0] === "app" && parts.length >= 3 && /^[A-Z]/.test(parts[1]!)) {
    return parts[1]!;
  }
  return parts[0]!;
}
```

Heuristic rationale: top-level dir is the module, EXCEPT for Laravel's `app/<PascalCase>/...` layout where the second segment is the conventional module name (Http, Models, Services). The PascalCase check (`/^[A-Z]/`) distinguishes Laravel's `app/Models` from Next.js's `app/api`.

- [ ] **Step 4: Run to verify passes**

Run: `npx vitest run tests/modules.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules.ts tests/modules.test.ts
git commit -m "feat: heuristic module detection from path"
```

---

## Task 9: Writer (Repo, Module, File, CONTAINS) — integration

**Files:**
- Create: `src/writer.ts`
- Test: `tests/writer.test.ts`

- [ ] **Step 1: Failing test** at `tests/writer.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client, applySchemas } from "arcadedb-agent-memory";
import { upsertRepo, upsertModule, upsertFile, linkContains } from "../src/writer.js";
import { createTempDb, env, type TempDb } from "./helpers/temp-db.js";

let db: TempDb;
const client = new Client(env);

beforeAll(async () => {
  db = await createTempDb("writer");
  await applySchemas(client, db.name, ["core", "code"]);
});
afterAll(async () => { await db.drop(); });

describe("writer (repo/module/file + CONTAINS)", () => {
  it("upsertRepo creates a :Repo with the given name", async () => {
    await upsertRepo(client, db.name, { name: "example-app", path: "/tmp/example-app", stack: "nextjs" });
    const rows = await client.query<{ "r.name": string; "r.stack": string }>(
      db.name, "cypher", "MATCH (r:Repo {name: 'example-app'}) RETURN r.name, r.stack"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["r.stack"]).toBe("nextjs");
  });

  it("upsertRepo is idempotent (no duplicate after second call)", async () => {
    await upsertRepo(client, db.name, { name: "example-app", path: "/tmp/example-app", stack: "nextjs" });
    const rows = await client.query<{ count: number }>(
      db.name, "cypher", "MATCH (r:Repo {name: 'example-app'}) RETURN count(r) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("upsertModule creates a :Module with composite path", async () => {
    await upsertModule(client, db.name, { name: "app", path: "example-app/app", language: "ts" });
    const rows = await client.query<{ "m.name": string }>(
      db.name, "cypher", "MATCH (m:Module {path: 'example-app/app'}) RETURN m.name"
    );
    expect(rows[0]?.["m.name"]).toBe("app");
  });

  it("upsertFile creates a :File at the given path", async () => {
    await upsertFile(client, db.name, { path: "example-app/app/page.tsx", language: "ts", loc: 5, hash: "abc" });
    const rows = await client.query<{ "f.language": string; "f.loc": number }>(
      db.name, "cypher", "MATCH (f:File {path: 'example-app/app/page.tsx'}) RETURN f.language, f.loc"
    );
    expect(rows[0]?.["f.language"]).toBe("ts");
    expect(rows[0]?.["f.loc"]).toBe(5);
  });

  it("linkContains creates a :CONTAINS edge from parent to child", async () => {
    await linkContains(client, db.name, "Repo", { name: "example-app" }, "Module", { path: "example-app/app" });
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      "MATCH (r:Repo {name: 'example-app'})-[:CONTAINS]->(m:Module {path: 'example-app/app'}) RETURN count(*) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("linkContains is idempotent (no duplicate edges)", async () => {
    await linkContains(client, db.name, "Repo", { name: "example-app" }, "Module", { path: "example-app/app" });
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      "MATCH (r:Repo {name: 'example-app'})-[:CONTAINS]->(m:Module {path: 'example-app/app'}) RETURN count(*) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npx vitest run tests/writer.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** at `src/writer.ts`

```ts
import type { Client } from "arcadedb-agent-memory";

function q(s: string | number | undefined | null): string {
  if (s === undefined || s === null) return "null";
  if (typeof s === "number") return String(s);
  return `'${String(s).replace(/'/g, "\\'")}'`;
}

export interface RepoInput { name: string; path: string; stack?: string }
export interface ModuleInput { name: string; path: string; language?: string }
export interface FileInput { path: string; language: string; loc?: number; hash?: string }

export async function upsertRepo(client: Client, db: string, repo: RepoInput): Promise<void> {
  const cy = `
    MERGE (r:Repo {name: ${q(repo.name)}})
    SET r.path = ${q(repo.path)},
        r.stack = ${q(repo.stack)},
        r.lastIndexedAt = datetime(${q(new Date().toISOString())})
  `;
  await client.execute(db, "cypher", cy);
}

export async function upsertModule(client: Client, db: string, mod: ModuleInput): Promise<void> {
  const cy = `
    MERGE (m:Module {path: ${q(mod.path)}})
    SET m.name = ${q(mod.name)},
        m.language = ${q(mod.language)}
  `;
  await client.execute(db, "cypher", cy);
}

export async function upsertFile(client: Client, db: string, file: FileInput): Promise<void> {
  const cy = `
    MERGE (f:File {path: ${q(file.path)}})
    SET f.language = ${q(file.language)},
        f.loc = ${q(file.loc)},
        f.hash = ${q(file.hash)},
        f.modifiedAt = datetime(${q(new Date().toISOString())})
  `;
  await client.execute(db, "cypher", cy);
}

export async function linkContains(
  client: Client,
  db: string,
  parentLabel: string,
  parentKey: Record<string, string>,
  childLabel: string,
  childKey: Record<string, string>,
): Promise<void> {
  const pk = Object.entries(parentKey).map(([k, v]) => `${k}: ${q(v)}`).join(", ");
  const ck = Object.entries(childKey).map(([k, v]) => `${k}: ${q(v)}`).join(", ");
  const cy = `
    MATCH (p:${parentLabel} {${pk}})
    MATCH (c:${childLabel} {${ck}})
    MERGE (p)-[:CONTAINS]->(c)
  `;
  await client.execute(db, "cypher", cy);
}
```

- [ ] **Step 4: Run to verify passes**

Run: `npx vitest run tests/writer.test.ts`
Expected: PASS, 6 tests.

If ArcadeDB's Cypher does not support MERGE-on-edge syntax (the test labeled "no duplicate edges" would fail), you'll see two edges instead of one. Fix path: replace the MERGE-edge with a guarded pattern (`MATCH … WHERE NOT (p)-[:CONTAINS]->(c) CREATE …`). Do not weaken the test — change the implementation.

- [ ] **Step 5: Commit**

```bash
git add src/writer.ts tests/writer.test.ts
git commit -m "feat: writer for :Repo, :Module, :File + :CONTAINS edges"
```

---

## Task 10: IMPORTS edge writer + linkImports

**Files:**
- Modify: `src/writer.ts` (append linkImports)
- Test: `tests/writer.test.ts` (append imports test)

- [ ] **Step 1: Append failing test** to `tests/writer.test.ts`

```ts
describe("writer (IMPORTS)", () => {
  it("linkImports creates an :IMPORTS edge between two files", async () => {
    await upsertFile(client, db.name, { path: "example-app/app/page.tsx", language: "ts" });
    await upsertFile(client, db.name, { path: "example-app/components/Button.tsx", language: "ts" });
    const { linkImports } = await import("../src/writer.js");
    await linkImports(client, db.name, "example-app/app/page.tsx", "example-app/components/Button.tsx");
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      "MATCH (a:File {path: 'example-app/app/page.tsx'})-[:IMPORTS]->(b:File {path: 'example-app/components/Button.tsx'}) RETURN count(*) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("linkImports is idempotent", async () => {
    const { linkImports } = await import("../src/writer.js");
    await linkImports(client, db.name, "example-app/app/page.tsx", "example-app/components/Button.tsx");
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      "MATCH (a:File {path: 'example-app/app/page.tsx'})-[:IMPORTS]->(b:File {path: 'example-app/components/Button.tsx'}) RETURN count(*) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("linkImports records unresolved external specifiers as a property when target file is missing", async () => {
    await upsertFile(client, db.name, { path: "example-app/lib/db.ts", language: "ts" });
    const { linkImports } = await import("../src/writer.js");
    await linkImports(client, db.name, "example-app/lib/db.ts", null, "next/server");
    const rows = await client.query<{ "f.unresolvedImports": string | null }>(
      db.name, "cypher",
      "MATCH (f:File {path: 'example-app/lib/db.ts'}) RETURN f.unresolvedImports"
    );
    const val = rows[0]?.["f.unresolvedImports"] ?? "";
    const list = val.split(",").map(s => s.trim()).filter(Boolean);
    expect(list).toContain("next/server");
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npx vitest run tests/writer.test.ts`
Expected: FAIL (linkImports not defined).

- [ ] **Step 3: Append impl** to `src/writer.ts`

```ts
export async function linkImports(
  client: Client,
  db: string,
  fromPath: string,
  toPath: string | null,
  unresolvedSpec?: string,
): Promise<void> {
  if (toPath) {
    const cy = `
      MATCH (a:File {path: ${q(fromPath)}})
      MATCH (b:File {path: ${q(toPath)}})
      MERGE (a)-[:IMPORTS]->(b)
    `;
    await client.execute(db, "cypher", cy);
    return;
  }
  if (unresolvedSpec) {
    const cy = `
      MATCH (f:File {path: ${q(fromPath)}})
      SET f.unresolvedImports = coalesce(f.unresolvedImports, '') + ${q(unresolvedSpec + ',')}
    `;
    await client.execute(db, "cypher", cy);
  }
}
```

Note: `unresolvedImports` is stored as a comma-separated STRING (not an array) because ArcadeDB Cypher's LIST property support is uncertain at v0.1. The test splits on commas to recover the values. If the implementation needs to switch to an array later, update the test parsing.

- [ ] **Step 4: Run to verify passes**

Run: `npx vitest run tests/writer.test.ts`
Expected: PASS, 9 tests total (6 from Task 9 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/writer.ts tests/writer.test.ts
git commit -m "feat: :IMPORTS edges + unresolved-spec property"
```

---

## Task 11: Orchestration — indexRepo()

**Files:**
- Create: `src/indexer.ts`
- Create: `src/index.ts`

- [ ] **Step 1: Implement orchestration** at `src/indexer.ts`

```ts
import { readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Client, applySchemas } from "arcadedb-agent-memory";
import { walkRepo } from "./walker.js";
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

  const files = await walkRepo(root);

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
```

The resolver tries the base path first, then common JS/TS extensions in priority order, and returns the first candidate that actually exists in the indexed file set. If none match, returns null and the import is recorded as unresolved.

- [ ] **Step 2: Public API** at `src/index.ts`

```ts
export { indexRepo } from "./indexer.js";
export type { IndexOptions, IndexSummary } from "./indexer.js";
export { walkRepo } from "./walker.js";
export { detectLanguage, type Language } from "./languages.js";
export { detectModule } from "./modules.js";
export { parseTsImports } from "./parsers/ts-imports.js";
export { parsePhpImports } from "./parsers/php-imports.js";
export { resolveRelative, resolvePsr4, type Psr4Map } from "./resolvers/path.js";
export {
  upsertRepo, upsertModule, upsertFile, linkContains, linkImports,
  type RepoInput, type ModuleInput, type FileInput,
} from "./writer.js";
```

- [ ] **Step 3: Verify build clean**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/indexer.ts src/index.ts
git commit -m "feat: indexRepo orchestration + public API"
```

---

## Task 12: CLI — arcadedb-index

**Files:**
- Create: `bin/arcadedb-index.ts`

- [ ] **Step 1: Implement CLI** at `bin/arcadedb-index.ts`

```ts
#!/usr/bin/env node
import { resolve } from "node:path";
import { Client, loadEnv } from "arcadedb-agent-memory";
import { indexRepo } from "../src/indexer.js";

const argv = process.argv.slice(2);
const [target, ...rest] = argv;

function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
}

function bool(name: string): boolean {
  return rest.includes(`--${name}`);
}

async function main(): Promise<number> {
  if (!target) {
    console.error("usage: arcadedb-index <dir> --db <name> [--auto-migrate] [--stack nextjs|laravel|...]");
    return 1;
  }
  const db = flag("db");
  if (!db) {
    console.error("error: --db <name> is required");
    return 1;
  }

  const client = new Client(loadEnv());
  const summary = await indexRepo(client, resolve(target), {
    db,
    autoMigrate: bool("auto-migrate"),
    stack: flag("stack"),
  });

  console.log(`indexed ${summary.repo}: ${summary.files} files, ${summary.imports} imports, ${summary.unresolved} unresolved`);
  return 0;
}

main().then(code => process.exit(code)).catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add bin/arcadedb-index.ts
git commit -m "feat: arcadedb-index CLI"
```

---

## Task 13: End-to-end integration test — tiny Next.js

**Files:**
- Test: `tests/indexer.test.ts`

- [ ] **Step 1: Failing test** at `tests/indexer.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve } from "node:path";
import { Client, applySchemas } from "arcadedb-agent-memory";
import { indexRepo } from "../src/indexer.js";
import { createTempDb, env, type TempDb } from "./helpers/temp-db.js";

const nextjsRoot = resolve(__dirname, "fixtures/tiny-nextjs");

let db: TempDb;
const client = new Client(env);

beforeAll(async () => {
  db = await createTempDb("e2e-nextjs");
  await applySchemas(client, db.name, ["core", "code"]);
});
afterAll(async () => { await db.drop(); });

describe("indexRepo (Next.js fixture)", () => {
  it("produces non-zero file and import counts", async () => {
    const summary = await indexRepo(client, nextjsRoot, { db: db.name, stack: "nextjs" });
    expect(summary.files).toBeGreaterThan(0);
    expect(summary.imports + summary.unresolved).toBeGreaterThan(0);
  });

  it("creates the :Repo node with stack=nextjs", async () => {
    const rows = await client.query<{ "r.stack": string }>(
      db.name, "cypher", "MATCH (r:Repo {name: 'tiny-nextjs'}) RETURN r.stack"
    );
    expect(rows[0]?.["r.stack"]).toBe("nextjs");
  });

  it("creates expected modules", async () => {
    const rows = await client.query<{ "m.name": string }>(
      db.name, "cypher",
      "MATCH (r:Repo {name: 'tiny-nextjs'})-[:CONTAINS]->(m:Module) RETURN m.name ORDER BY m.name"
    );
    const names = rows.map(r => r["m.name"]);
    expect(names).toEqual(expect.arrayContaining(["app", "components", "lib"]));
  });

  it("creates the resolved :IMPORTS edge from page.tsx to Button.tsx", async () => {
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      `MATCH (a:File {path: 'tiny-nextjs/app/page.tsx'})-[:IMPORTS]->(b:File {path: 'tiny-nextjs/components/Button.tsx'}) RETURN count(*) AS count`
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("creates the resolved :IMPORTS edge from page.tsx to lib/db.ts", async () => {
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      `MATCH (a:File {path: 'tiny-nextjs/app/page.tsx'})-[:IMPORTS]->(b:File {path: 'tiny-nextjs/lib/db.ts'}) RETURN count(*) AS count`
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("records 'react' as unresolved on Button.tsx", async () => {
    const rows = await client.query<{ "f.unresolvedImports": string | null }>(
      db.name, "cypher", `MATCH (f:File {path: 'tiny-nextjs/components/Button.tsx'}) RETURN f.unresolvedImports`
    );
    expect(rows[0]?.["f.unresolvedImports"] ?? "").toMatch(/react/);
  });
});
```

- [ ] **Step 2: Run to verify**

Run: `npx vitest run tests/indexer.test.ts`
Expected: PASS, 6 tests. The Task 11 resolver already handles `.tsx`, `.ts`, `.js`, etc. priority lookup against the indexed file set, so `./components/Button` → `components/Button.tsx` is found automatically.

- [ ] **Step 3: Commit**

```bash
git add tests/indexer.test.ts
git commit -m "test: end-to-end indexing on tiny-nextjs fixture"
```

---

## Task 14: End-to-end integration test — tiny Laravel

**Files:**
- Modify: `tests/indexer.test.ts` (append Laravel describe block)

- [ ] **Step 1: Append test**

```ts
const laravelRoot = resolve(__dirname, "fixtures/tiny-laravel");

describe("indexRepo (Laravel fixture)", () => {
  let lDb: TempDb;
  beforeAll(async () => {
    lDb = await createTempDb("e2e-laravel");
    await applySchemas(client, lDb.name, ["core", "code"]);
  });
  afterAll(async () => { await lDb.drop(); });

  it("creates the :Repo and PSR-4 resolved imports", async () => {
    const summary = await indexRepo(client, laravelRoot, { db: lDb.name, stack: "laravel" });
    expect(summary.files).toBeGreaterThan(0);

    const rows = await client.query<{ count: number }>(
      lDb.name, "cypher",
      `MATCH (a:File {path: 'tiny-laravel/app/Http/Controllers/UserController.php'})-[:IMPORTS]->(b:File {path: 'tiny-laravel/app/Models/User.php'}) RETURN count(*) AS count`
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("creates Laravel module nodes (Http, Models, Services)", async () => {
    const rows = await client.query<{ "m.name": string }>(
      lDb.name, "cypher",
      "MATCH (r:Repo {name: 'tiny-laravel'})-[:CONTAINS]->(m:Module) RETURN m.name ORDER BY m.name"
    );
    const names = rows.map(r => r["m.name"]);
    expect(names).toEqual(expect.arrayContaining(["Http", "Models", "Services"]));
  });

  it("records 'Illuminate\\\\Database\\\\Eloquent\\\\Model' as unresolved on User.php", async () => {
    const rows = await client.query<{ "f.unresolvedImports": string | null }>(
      lDb.name, "cypher", `MATCH (f:File {path: 'tiny-laravel/app/Models/User.php'}) RETURN f.unresolvedImports`
    );
    expect(rows[0]?.["f.unresolvedImports"] ?? "").toMatch(/Illuminate/);
  });
});
```

- [ ] **Step 2: Run to verify**

Run: `npx vitest run tests/indexer.test.ts`
Expected: PASS, 9 tests total (6 from Task 13 + 3 new).

- [ ] **Step 3: Commit**

```bash
git add tests/indexer.test.ts
git commit -m "test: end-to-end indexing on tiny-laravel fixture (PSR-4)"
```

---

## Task 15: CLI integration test

**Files:**
- Test: `tests/cli/index.test.ts`

- [ ] **Step 1: Failing test** at `tests/cli/index.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { Client, applySchemas } from "arcadedb-agent-memory";
import { createTempDb, env, type TempDb } from "../helpers/temp-db.js";

const exec = promisify(execFile);
const nextjsRoot = resolve(__dirname, "../fixtures/tiny-nextjs");

let db: TempDb;
const client = new Client(env);

beforeAll(async () => {
  db = await createTempDb("cli-index");
  await applySchemas(client, db.name, ["core", "code"]);
});
afterAll(async () => { await db.drop(); });

describe("CLI: arcadedb-index", () => {
  it("indexes a repo and prints a summary line", async () => {
    const { stdout } = await exec("npx", [
      "tsx", "bin/arcadedb-index.ts", nextjsRoot,
      "--db", db.name,
      "--stack", "nextjs",
    ]);
    expect(stdout).toMatch(/indexed tiny-nextjs: \d+ files, \d+ imports, \d+ unresolved/);
  });

  it("--auto-migrate makes the CLI work against a fresh DB without prior migration", async () => {
    const fresh = await createTempDb("cli-fresh");
    try {
      const { stdout } = await exec("npx", [
        "tsx", "bin/arcadedb-index.ts", nextjsRoot,
        "--db", fresh.name,
        "--auto-migrate",
      ]);
      expect(stdout).toMatch(/indexed tiny-nextjs/);
    } finally { await fresh.drop(); }
  });

  it("exits 1 when --db is missing", async () => {
    await expect(exec("npx", ["tsx", "bin/arcadedb-index.ts", nextjsRoot])).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify**

Run: `npx vitest run tests/cli/index.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 3: Commit**

```bash
git add tests/cli/index.test.ts
git commit -m "test: CLI integration (index + auto-migrate)"
```

---

## Task 16: CI workflow + README

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
          path: arcadedb-code-indexer
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - name: build agent-memory
        working-directory: arcadedb-agent-memory
        run: npm install && npm run build
      - name: install indexer
        working-directory: arcadedb-code-indexer
        run: npm install
      - name: typecheck
        working-directory: arcadedb-code-indexer
        run: npx tsc --noEmit
      - name: unit tests (no DB)
        working-directory: arcadedb-code-indexer
        run: npm run test:unit
```

Note: CI runs unit tests only (parsers, walker, language detection, modules, resolvers). Integration tests need both a running ArcadeDB and the sibling repo, kept as local-only for v0.1. Future v0.1.1 work: add an integration job that spins up ArcadeDB as a service container (mirror the Phase 1 pattern).

Note: the `SIBLING_REPO_DEPLOY_KEY` secret is needed because `arcadedb-agent-memory` is a private repo. If you don't want to set up the deploy key yet, omit the unit job's sibling-checkout step and skip CI for now — the README + LICENSE commit still ships.

- [ ] **Step 2: README** at `README.md`

```markdown
# arcadedb-code-indexer

CLI that walks a TypeScript/JavaScript or Laravel codebase and writes its structure into an [ArcadeDB](https://arcadedb.com) graph. Phase 2 of the `arcadedb-claude` suite.

## Install

```bash
npm install -g arcadedb-code-indexer
```

(Requires `arcadedb-agent-memory` and a running ArcadeDB on `localhost:2480`.)

## Setup

1. Run an ArcadeDB container locally (port 2480).
2. Put credentials in `~/.config/arcadedb/.env` (see `arcadedb-agent-memory` for format).
3. Create a database to index into.

## Usage

```bash
# Index a repo, write to the named DB. Assumes the DB already has the schema applied.
arcadedb-index ./some-project --db project-a

# Index a fresh DB by applying schema first.
arcadedb-index ./some-project --db project-a --auto-migrate

# Tag the repo with a stack hint (informational; written to :Repo.stack).
arcadedb-index ./some-project --db project-a --stack nextjs
```

## What it writes

- `:Repo` (one per indexed root, keyed by basename)
- `:Module` (top-level dir, or Laravel `app/<PascalCase>` subdir)
- `:File` (every source file in the repo)
- `:CONTAINS` (Repo → Module → File hierarchy)
- `:IMPORTS` (File → File, resolved via relative paths or PSR-4)

Unresolved import specifiers (npm packages, namespace prefixes outside the PSR-4 map) are stored as a comma-separated `unresolvedImports` property on the source `:File`.

## Limitations (v0.1.0)

- Regex-based parsing, not AST. Edge cases like multi-line import statements with unusual formatting may be missed.
- Only relative imports are resolved for TS/JS. Path aliases (`@/`) and TS `paths` config are not honored.
- PHP resolution assumes the default Laravel `App\` → `app/` PSR-4 mapping unless overridden in code.
- No class, function, or call graph extraction. Those land in v0.2 (AST-based) and v0.3 (call graph).

## License

MIT
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "chore: CI workflow + README"
```

---

## Task 17: Final verification + v0.1.0 tag

- [ ] **Step 1: Build clean**

Run: `npm run build`
Expected: `dist/` populated, no errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all tests pass (~33). Report exact count.

- [ ] **Step 3: Manual smoke test against a real DB**

Run:
```bash
npx tsx bin/arcadedb-index.ts tests/fixtures/tiny-nextjs --db claude_memory --auto-migrate --stack nextjs
```

Expected: prints `indexed tiny-nextjs: 5 files, N imports, M unresolved` (N and M depend on resolution).

Then verify in ArcadeDB Studio at http://localhost:2480:
```cypher
MATCH (r:Repo {name: 'tiny-nextjs'})-[:CONTAINS]->(m:Module)-[:CONTAINS]->(f:File)
RETURN m.name, f.path
ORDER BY m.name, f.path
```

Expected: rows for app/page.tsx, app/api/users/route.ts, components/Button.tsx, lib/db.ts, lib/validate.ts grouped by module.

- [ ] **Step 4: Tag the release**

```bash
git tag v0.1.0
```

Do NOT push yet. Report the tagged SHA.

- [ ] **Step 5: Status check**

Run: `git status`
Expected: clean.

---

## Phase 2 done. Next: Phase 3.

When this phase ships, return to writing-plans and create `2026-05-17-phase3-claude-skills.md`. Phase 3 builds the Claude Code plugin that shells out to this indexer via `/graph-index`.
