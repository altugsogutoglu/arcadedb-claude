# Java Import Parsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Java (`.java`) support to `arcadedb-code-indexer` so Java repos produce the same import graph (`Repo`→`Module`→`File`, `File`-[:IMPORTS]->`File`/`Module`) that TS/JS/PHP produce today.

**Architecture:** Java slots into the existing per-language pattern: extend `languages.ts`, add a zero-dependency regex parser (`parsers/java-imports.ts`) and a pure resolver (`resolvers/java.ts`), add one writer helper (`linkImportsToModule`), and branch the two-pass loop in `indexer.ts`. Resolution derives each file's fully-qualified type name from its `package` declaration and builds an `FQN → path` index, so `import com.foo.Bar;` is a direct lookup. The Java "module" unit is the package; wildcard imports (`import com.foo.*;`) link `File`→`Module`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, ArcadeDB (Cypher via `arcadedb-agent-memory`). Node ≥ 20.

**Spec:** `docs/superpowers/specs/2026-06-03-java-parsing-design.md`

---

## File Structure

- **Create** `packages/code-indexer/src/parsers/java-imports.ts` — `parseJavaPackage`, `parseJavaImports`, `JavaImport` type. Comment stripping + regex extraction.
- **Create** `packages/code-indexer/src/resolvers/java.ts` — `javaFqnForFile`, `resolveJavaImport`, `JavaResolution` type. Pure functions, no DB, no I/O.
- **Modify** `packages/code-indexer/src/languages.ts` — add `"java"` to the `Language` union and `.java` detection.
- **Modify** `packages/code-indexer/src/writer.ts` — add `linkImportsToModule` (`File`-[:IMPORTS]->`Module`).
- **Modify** `packages/code-indexer/src/indexer.ts` — build the Java FQN index + package set in pass 1; branch Java resolution in pass 2.
- **Create** `packages/code-indexer/tests/parsers/java-imports.test.ts`
- **Create** `packages/code-indexer/tests/resolvers/java.test.ts`
- **Create** fixture files under `packages/code-indexer/tests/fixtures/tiny-java/`
- **Modify** `packages/code-indexer/tests/languages.test.ts`, `tests/writer.test.ts`, `tests/indexer.test.ts`
- **Modify** `packages/code-indexer/README.md` and root `README.md` — note Java support.

**Working directory for all commands:** `packages/code-indexer`. No schema change is required — `IMPORTS` is an endpoint-agnostic edge.

**Test tiers:** parser/resolver/languages tests are pure unit tests (no DB). `writer.test.ts` and `indexer.test.ts` require a running ArcadeDB (they call `createTempDb`, which uses `loadEnv()`). Run unit tests with `npx vitest run <file>`; run DB-backed tests only with ArcadeDB reachable.

---

## Task 1: Detect `.java` files

**Files:**
- Modify: `src/languages.ts`
- Test: `tests/languages.test.ts`

- [ ] **Step 1: Add the failing test**

In `tests/languages.test.ts`, add this `it` block inside the existing `describe("detectLanguage", ...)`, after the PHP test:

```ts
  it("identifies Java files", () => {
    expect(detectLanguage("src/main/java/com/example/Main.java")).toBe("java");
    expect(detectLanguage("App.java")).toBe("java");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/languages.test.ts`
Expected: FAIL — the Java assertions get `"other"` instead of `"java"`.

- [ ] **Step 3: Implement**

In `src/languages.ts`, change the `Language` type and add the extension set + branch:

```ts
export type Language = "ts" | "js" | "php" | "java" | "other";

const TS_EXT = new Set([".ts", ".tsx"]);
const JS_EXT = new Set([".js", ".jsx", ".mjs", ".cjs"]);
const PHP_EXT = new Set([".php"]);
const JAVA_EXT = new Set([".java"]);

export function detectLanguage(path: string): Language {
  const ext = extOf(path);
  if (TS_EXT.has(ext)) return "ts";
  if (JS_EXT.has(ext)) return "js";
  if (PHP_EXT.has(ext)) return "php";
  if (JAVA_EXT.has(ext)) return "java";
  return "other";
}
```

(Leave `extOf` unchanged.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/languages.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add src/languages.ts tests/languages.test.ts
git commit -m "feat(code-indexer): detect .java files as language 'java'"
```

---

## Task 2: Java import parser

**Files:**
- Create: `src/parsers/java-imports.ts`
- Test: `tests/parsers/java-imports.test.ts`

Parser contract:
- `parseJavaPackage(source)` → the package name from `package com.foo;`, or `null` (default package).
- `parseJavaImports(source)` → `JavaImport[]` where each item is the resolvable target:
  - `import com.foo.Bar;` → `{ fqn: "com.foo.Bar", kind: "single" }`
  - `import static com.foo.Bar.method;` → `{ fqn: "com.foo.Bar", kind: "static" }` (trailing member dropped → class FQN)
  - `import static com.foo.Bar.*;` → `{ fqn: "com.foo.Bar", kind: "static" }` (trailing `*` dropped → class FQN)
  - `import com.foo.*;` → `{ fqn: "com.foo", kind: "wildcard" }` (package name)
- Commented-out imports/packages must be ignored.

- [ ] **Step 1: Write the failing test**

Create `tests/parsers/java-imports.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseJavaPackage, parseJavaImports } from "../../src/parsers/java-imports.js";

describe("parseJavaPackage", () => {
  it("extracts the package name", () => {
    expect(parseJavaPackage(`package com.example.app;\n\nclass X {}`)).toBe("com.example.app");
  });

  it("returns null for the default package", () => {
    expect(parseJavaPackage(`class X {}`)).toBeNull();
  });

  it("ignores a commented-out package line", () => {
    expect(parseJavaPackage(`// package com.commented;\npackage com.real;`)).toBe("com.real");
  });
});

describe("parseJavaImports", () => {
  it("extracts a single import as the class FQN", () => {
    expect(parseJavaImports(`import com.foo.Bar;`)).toEqual([
      { fqn: "com.foo.Bar", kind: "single" },
    ]);
  });

  it("extracts a static import as the class FQN (drops the member)", () => {
    expect(parseJavaImports(`import static com.foo.Bar.method;`)).toEqual([
      { fqn: "com.foo.Bar", kind: "static" },
    ]);
  });

  it("extracts a static wildcard import as the class FQN", () => {
    expect(parseJavaImports(`import static com.foo.Bar.*;`)).toEqual([
      { fqn: "com.foo.Bar", kind: "static" },
    ]);
  });

  it("extracts a type wildcard import as the package name", () => {
    expect(parseJavaImports(`import com.foo.*;`)).toEqual([
      { fqn: "com.foo", kind: "wildcard" },
    ]);
  });

  it("extracts multiple imports in order", () => {
    const src = `package com.app;
import com.foo.Bar;
import com.baz.*;
import static java.lang.Math.max;

public class App {}`;
    expect(parseJavaImports(src)).toEqual([
      { fqn: "com.foo.Bar", kind: "single" },
      { fqn: "com.baz", kind: "wildcard" },
      { fqn: "java.lang.Math", kind: "static" },
    ]);
  });

  it("ignores commented-out imports", () => {
    const src = `// import com.dead.Class;\n/* import com.block.Thing; */\nimport com.live.Real;`;
    expect(parseJavaImports(src)).toEqual([
      { fqn: "com.live.Real", kind: "single" },
    ]);
  });

  it("returns an empty array when there are no imports", () => {
    expect(parseJavaImports(`package com.app;\npublic class App {}`)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/parsers/java-imports.test.ts`
Expected: FAIL — module `../../src/parsers/java-imports.js` not found.

- [ ] **Step 3: Implement the parser**

Create `src/parsers/java-imports.ts`:

```ts
export interface JavaImport {
  /** The class FQN (single/static) or package name (wildcard) to resolve. */
  fqn: string;
  kind: "single" | "static" | "wildcard";
}

const PACKAGE_RE = /^\s*package\s+([\w.]+)\s*;/m;
const IMPORT_RE = /^\s*import\s+(static\s+)?([\w.]+(?:\.\*)?)\s*;/gm;

export function parseJavaPackage(source: string): string | null {
  const m = PACKAGE_RE.exec(stripComments(source));
  return m ? m[1]! : null;
}

export function parseJavaImports(source: string): JavaImport[] {
  const stripped = stripComments(source);
  const out: JavaImport[] = [];
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(stripped)) !== null) {
    const isStatic = Boolean(m[1]);
    const ref = m[2]!;
    if (isStatic) {
      // Drop the trailing member (a name or '*') to get the owning class FQN.
      out.push({ fqn: dropLastSegment(ref), kind: "static" });
    } else if (ref.endsWith(".*")) {
      out.push({ fqn: ref.slice(0, -2), kind: "wildcard" });
    } else {
      out.push({ fqn: ref, kind: "single" });
    }
  }
  return out;
}

function dropLastSegment(fqn: string): string {
  const i = fqn.lastIndexOf(".");
  return i === -1 ? fqn : fqn.slice(0, i);
}

function stripComments(src: string): string {
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
    out += c;
    i++;
  }
  return out;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/parsers/java-imports.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add src/parsers/java-imports.ts tests/parsers/java-imports.test.ts
git commit -m "feat(code-indexer): parse Java package + import statements"
```

---

## Task 3: Java resolver

**Files:**
- Create: `src/resolvers/java.ts`
- Test: `tests/resolvers/java.test.ts`

Resolver contract:
- `javaFqnForFile(relPath, pkg)` → the file's FQN: `pkg ? "${pkg}.${ClassName}" : ClassName`, where `ClassName` is the filename without `.java`.
- `resolveJavaImport(imp, typeIndex, packages)` → a `JavaResolution`:
  - `single`/`static` → look up `imp.fqn` in `typeIndex` (FQN→relPath); hit → `{ kind: "file", path }`, miss → `{ kind: "unresolved", spec: imp.fqn }`.
  - `wildcard` → if `packages` has `imp.fqn` → `{ kind: "module", pkg: imp.fqn }`, else `{ kind: "unresolved", spec: imp.fqn + ".*" }`.

- [ ] **Step 1: Write the failing test**

Create `tests/resolvers/java.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { javaFqnForFile, resolveJavaImport } from "../../src/resolvers/java.js";

describe("javaFqnForFile", () => {
  it("combines package and class name", () => {
    expect(javaFqnForFile("src/main/java/com/foo/Bar.java", "com.foo")).toBe("com.foo.Bar");
  });

  it("uses the bare class name for the default package", () => {
    expect(javaFqnForFile("Main.java", null)).toBe("Main");
  });
});

describe("resolveJavaImport", () => {
  const typeIndex = new Map<string, string>([
    ["com.foo.Bar", "src/main/java/com/foo/Bar.java"],
    ["com.foo.Util", "src/main/java/com/foo/Util.java"],
  ]);
  const packages = new Set<string>(["com.foo"]);

  it("resolves a single import to its file", () => {
    expect(resolveJavaImport({ fqn: "com.foo.Bar", kind: "single" }, typeIndex, packages))
      .toEqual({ kind: "file", path: "src/main/java/com/foo/Bar.java" });
  });

  it("resolves a static import to its class file", () => {
    expect(resolveJavaImport({ fqn: "com.foo.Util", kind: "static" }, typeIndex, packages))
      .toEqual({ kind: "file", path: "src/main/java/com/foo/Util.java" });
  });

  it("resolves a type wildcard to the package module", () => {
    expect(resolveJavaImport({ fqn: "com.foo", kind: "wildcard" }, typeIndex, packages))
      .toEqual({ kind: "module", pkg: "com.foo" });
  });

  it("reports a missing single import as unresolved", () => {
    expect(resolveJavaImport({ fqn: "java.util.List", kind: "single" }, typeIndex, packages))
      .toEqual({ kind: "unresolved", spec: "java.util.List" });
  });

  it("reports a wildcard for an unknown package as unresolved (with .*)", () => {
    expect(resolveJavaImport({ fqn: "org.external", kind: "wildcard" }, typeIndex, packages))
      .toEqual({ kind: "unresolved", spec: "org.external.*" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/resolvers/java.test.ts`
Expected: FAIL — module `../../src/resolvers/java.js` not found.

- [ ] **Step 3: Implement the resolver**

Create `src/resolvers/java.ts`:

```ts
import type { JavaImport } from "../parsers/java-imports.js";

export type JavaResolution =
  | { kind: "file"; path: string }
  | { kind: "module"; pkg: string }
  | { kind: "unresolved"; spec: string };

/** A Java file's FQN is its package plus the class name taken from the filename. */
export function javaFqnForFile(relPath: string, pkg: string | null): string {
  const file = relPath.split("/").pop() ?? relPath;
  const base = file.replace(/\.java$/, "");
  return pkg ? `${pkg}.${base}` : base;
}

export function resolveJavaImport(
  imp: JavaImport,
  typeIndex: Map<string, string>,
  packages: Set<string>,
): JavaResolution {
  if (imp.kind === "wildcard") {
    if (packages.has(imp.fqn)) return { kind: "module", pkg: imp.fqn };
    return { kind: "unresolved", spec: `${imp.fqn}.*` };
  }
  const path = typeIndex.get(imp.fqn);
  if (path) return { kind: "file", path };
  return { kind: "unresolved", spec: imp.fqn };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/resolvers/java.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add src/resolvers/java.ts tests/resolvers/java.test.ts
git commit -m "feat(code-indexer): resolve Java imports to files and package modules"
```

---

## Task 4: Writer — link a File to a Module

**Files:**
- Modify: `src/writer.ts`
- Test: `tests/writer.test.ts` (requires a running ArcadeDB)

- [ ] **Step 1: Write the failing test**

In `tests/writer.test.ts`, add this `it` block at the end of the `describe("writer (IMPORTS)", ...)` block (before its closing `});`):

```ts
  it("linkImportsToModule creates an :IMPORTS edge from a file to a module", async () => {
    await upsertFile(client, db.name, { path: "example-app/app/Main.java", language: "java" });
    await upsertModule(client, db.name, { name: "com.example.model", path: "example-app/com.example.model", language: "java" });
    const { linkImportsToModule } = await import("../src/writer.js");
    await linkImportsToModule(client, db.name, "example-app/app/Main.java", "example-app/com.example.model");
    const rows = await client.query<{ count: number }>(
      db.name, "cypher",
      "MATCH (a:File {path: 'example-app/app/Main.java'})-[:IMPORTS]->(m:Module {path: 'example-app/com.example.model'}) RETURN count(*) AS count"
    );
    expect(rows[0]?.count).toBe(1);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/writer.test.ts`
Expected: FAIL — `linkImportsToModule` is not exported from `../src/writer.js`.

- [ ] **Step 3: Implement**

In `src/writer.ts`, add this function at the end of the file (it reuses the module-private `q` helper already defined at the top):

```ts
export async function linkImportsToModule(
  client: Client,
  db: string,
  fromFilePath: string,
  moduleQualified: string,
): Promise<void> {
  const cy = `
    MATCH (a:File {path: ${q(fromFilePath)}})
    MATCH (m:Module {path: ${q(moduleQualified)}})
    MERGE (a)-[:IMPORTS]->(m)
  `;
  await client.execute(db, "cypher", cy);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/writer.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add src/writer.ts tests/writer.test.ts
git commit -m "feat(code-indexer): add linkImportsToModule for File->Module imports"
```

---

## Task 5: Wire Java into the indexer

**Files:**
- Modify: `src/indexer.ts`

This task has no new test of its own; it is verified by the integration tests in Task 6. Make the edits, then build to confirm types.

- [ ] **Step 1: Add imports**

In `src/indexer.ts`, after the existing `parsePhpImports` import (line 8) add:

```ts
import { parseJavaImports, parseJavaPackage } from "./parsers/java-imports.js";
import { javaFqnForFile, resolveJavaImport } from "./resolvers/java.js";
```

And change the writer import line (currently importing `upsertRepo, upsertModule, upsertFile, linkContains, linkImports`) to also import the new helper:

```ts
import { upsertRepo, upsertModule, upsertFile, linkContains, linkImports, linkImportsToModule } from "./writer.js";
```

- [ ] **Step 2: Widen the language map and add Java accumulators**

Change the `fileLanguages` declaration (currently `new Map<string, "ts" | "js" | "php" | "other">()`) to include `"java"`, and add two accumulators directly below it:

```ts
  const fileLanguages = new Map<string, "ts" | "js" | "php" | "java" | "other">();
  const moduleNames = new Set<string>();
  let indexedFileCount = 0;

  /** FQN (e.g. "com.foo.Bar") -> repo-relative path, for Java import resolution. */
  const javaTypeIndex = new Map<string, string>();
  /** Java package names present in this repo (each is a Module). */
  const javaPackages = new Set<string>();
```

- [ ] **Step 3: Compute the Java module (package) in pass 1**

In the first `for (const rel of files)` loop, replace this line:

```ts
    const moduleName = detectModule(rel);
```

with:

```ts
    let moduleName: string;
    if (lang === "java") {
      const pkg = parseJavaPackage(source);
      moduleName = pkg ?? detectModule(rel);
      javaTypeIndex.set(javaFqnForFile(rel, pkg), rel);
      if (pkg) javaPackages.add(pkg);
    } else {
      moduleName = detectModule(rel);
    }
```

(`source` is already read earlier in this loop.)

- [ ] **Step 4: Branch Java resolution in pass 2**

In the second `for (const rel of files)` loop, the body currently reads `source`, then computes `specs` and `repoQualified`, then iterates `specs`. Replace this block:

```ts
    const source = await readFile(fullPath, "utf8");
    const specs = lang === "php" ? parsePhpImports(source) : parseTsImports(source);
    const repoQualified = `${repoName}/${rel}`;
```

with:

```ts
    const source = await readFile(fullPath, "utf8");
    const repoQualified = `${repoName}/${rel}`;

    if (lang === "java") {
      for (const imp of parseJavaImports(source)) {
        const res = resolveJavaImport(imp, javaTypeIndex, javaPackages);
        if (res.kind === "file") {
          await linkImports(client, options.db, repoQualified, `${repoName}/${res.path}`);
          importsCount++;
        } else if (res.kind === "module") {
          await linkImportsToModule(client, options.db, repoQualified, `${repoName}/${res.pkg}`);
          importsCount++;
        } else {
          await linkImports(client, options.db, repoQualified, null, res.spec);
          unresolvedCount++;
        }
      }
      continue;
    }

    const specs = lang === "php" ? parsePhpImports(source) : parseTsImports(source);
```

Leave the existing `for (const spec of specs)` loop that follows unchanged.

- [ ] **Step 5: Build to verify types**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors. (In particular, the `lang === "java"` branches must type-check against the widened `Language` union.)

- [ ] **Step 6: Commit**

```bash
git add src/indexer.ts
git commit -m "feat(code-indexer): index Java files (package modules + import edges)"
```

---

## Task 6: tiny-java fixture + integration tests

**Files:**
- Create: `tests/fixtures/tiny-java/src/main/java/com/example/app/Main.java`
- Create: `tests/fixtures/tiny-java/src/main/java/com/example/service/UserService.java`
- Create: `tests/fixtures/tiny-java/src/main/java/com/example/model/User.java`
- Modify: `tests/indexer.test.ts` (requires a running ArcadeDB)

The fixture exercises every resolution path: a cross-package single import (file→file), a type wildcard (file→module), a static external import (unresolved), and a plain external import (unresolved).

- [ ] **Step 1: Create the fixture files**

`tests/fixtures/tiny-java/src/main/java/com/example/model/User.java`:

```java
package com.example.model;

public class User {
    private String name;
    public String getName() { return name; }
}
```

`tests/fixtures/tiny-java/src/main/java/com/example/service/UserService.java`:

```java
package com.example.service;

import com.example.model.User;

public class UserService {
    public User find() { return new User(); }
}
```

`tests/fixtures/tiny-java/src/main/java/com/example/app/Main.java`:

```java
package com.example.app;

import com.example.service.UserService;
import com.example.model.*;
import java.util.List;
import static java.lang.Math.max;

public class Main {
    public static void main(String[] args) {
        List<UserService> services = null;
        int n = max(1, 2);
    }
}
```

- [ ] **Step 2: Add the failing integration tests**

In `tests/indexer.test.ts`, add this new `describe` block at the end of the file:

```ts
const javaRoot = resolve(__dirname, "fixtures/tiny-java");

describe("indexRepo (Java fixture)", () => {
  let jDb: TempDb;
  beforeAll(async () => {
    jDb = await createTempDb("e2e-java");
    await applySchemas(client, jDb.name, ["core", "code"]);
  });
  afterAll(async () => { await jDb.drop(); });

  it("indexes the repo and produces import counts", async () => {
    const summary = await indexRepo(client, javaRoot, { db: jDb.name, stack: "java" });
    expect(summary.files).toBeGreaterThan(0);
    expect(summary.imports + summary.unresolved).toBeGreaterThan(0);
  });

  it("creates package-named modules", async () => {
    const rows = await client.query<{ "m.name": string }>(
      jDb.name, "cypher",
      "MATCH (r:Repo {name: 'tiny-java'})-[:CONTAINS]->(m:Module) RETURN m.name ORDER BY m.name"
    );
    const names = rows.map(r => r["m.name"]);
    expect(names).toEqual(expect.arrayContaining([
      "com.example.app", "com.example.service", "com.example.model",
    ]));
  });

  it("resolves a single cross-package import to a file edge", async () => {
    const rows = await client.query<{ count: number }>(
      jDb.name, "cypher",
      `MATCH (a:File {path: 'tiny-java/src/main/java/com/example/service/UserService.java'})-[:IMPORTS]->(b:File {path: 'tiny-java/src/main/java/com/example/model/User.java'}) RETURN count(a) AS count`
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("resolves a wildcard import to a module edge", async () => {
    const rows = await client.query<{ count: number }>(
      jDb.name, "cypher",
      `MATCH (a:File {path: 'tiny-java/src/main/java/com/example/app/Main.java'})-[:IMPORTS]->(m:Module {path: 'tiny-java/com.example.model'}) RETURN count(a) AS count`
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("records the external java.util import as unresolved on Main.java", async () => {
    const rows = await client.query<{ "f.unresolvedImports": string | null }>(
      jDb.name, "cypher",
      `MATCH (f:File {path: 'tiny-java/src/main/java/com/example/app/Main.java'}) RETURN f.unresolvedImports`
    );
    expect(rows[0]?.["f.unresolvedImports"] ?? "").toMatch(/java\.util/);
  });
});
```

- [ ] **Step 3: Run it to verify it fails (then passes after Task 5 is in place)**

Run: `npx vitest run tests/indexer.test.ts`
Expected: the Java `describe` block PASSES if Task 5 is committed. If you are running this task before Task 5, the Java assertions FAIL (no java handling) — confirming the tests exercise the new behavior. With Task 5 in place, expected: PASS (all blocks, including the existing Next.js and Laravel ones).

- [ ] **Step 4: Run the full unit suite to confirm no regressions**

Run: `npx vitest run --exclude tests/writer.test.ts --exclude tests/indexer.test.ts --exclude 'tests/cli/**'`
Expected: PASS — all parser/resolver/languages/walker/modules tests green.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/tiny-java tests/indexer.test.ts
git commit -m "test(code-indexer): tiny-java fixture + Java indexing integration tests"
```

---

## Task 7: Documentation

**Files:**
- Modify: `packages/code-indexer/README.md`
- Modify: root `README.md`

- [ ] **Step 1: Update the code-indexer README**

In `packages/code-indexer/README.md`, line 3 currently reads:

```
CLI that walks a TypeScript/JavaScript or Laravel codebase and writes its structure into an [ArcadeDB](https://arcadedb.com) graph. Phase 2 of the `arcadedb-claude` suite.
```

Replace it with:

```
CLI that walks a TypeScript/JavaScript, PHP/Laravel, or Java codebase and writes its structure into an [ArcadeDB](https://arcadedb.com) graph. Phase 2 of the `arcadedb-claude` suite.
```

- [ ] **Step 2: Update the root README**

In the root `README.md`, the `arcadedb-code-indexer` table row describes it as walking a codebase "(TypeScript / JavaScript / PHP today)". Replace that parenthetical with `(TypeScript / JavaScript / PHP / Java today)`. Use this exact replacement on the matching line:

Find: `Walks a codebase (TypeScript / JavaScript / PHP today)`
Replace: `Walks a codebase (TypeScript / JavaScript / PHP / Java today)`

- [ ] **Step 3: Verify the edits**

Run: `grep -n "Java" README.md packages/code-indexer/README.md`
Expected: each file shows the updated line mentioning Java.

- [ ] **Step 4: Commit**

```bash
git add README.md packages/code-indexer/README.md
git commit -m "docs(code-indexer): document Java support"
```

---

## Final verification

- [ ] **Run the unit suite (no DB needed):**

Run: `npx vitest run --exclude tests/writer.test.ts --exclude tests/indexer.test.ts --exclude 'tests/cli/**'`
Expected: PASS.

- [ ] **Run the DB-backed suite (ArcadeDB must be reachable):**

Run: `npx vitest run tests/writer.test.ts tests/indexer.test.ts`
Expected: PASS — Next.js, Laravel, and Java fixtures all green.

- [ ] **Type-check the build:**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.
