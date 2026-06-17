# Java Parsing for `arcadedb-code-indexer` — Design

**Date:** 2026-06-03
**Package:** `packages/code-indexer`
**Status:** Approved (design phase)

## Goal

Add Java (`.java`) support to the code indexer so Java repositories produce the
same import graph (`Repo` → `Module` → `File`, `File` -[:IMPORTS]-> `File`) that
TypeScript/JavaScript and PHP produce today. Scope is **imports only** — no
class/method/symbol extraction. Java slots into the existing pluggable
per-language pattern (`languages.ts` + `parsers/*` + `resolvers/*`, wired in
`indexer.ts`), mirroring how PHP was added.

## Non-goals

- No class/interface/method nodes, no `CALLS`/`EXTENDS`/`IMPLEMENTS` edges.
- No build-file parsing (`pom.xml`, `build.gradle`). Source layout is derived
  from `package` declarations instead.
- No Maven/Gradle/Spring stack auto-detection. `stack` stays user-provided.

## Key design decisions

1. **Imports only**, matching the existing graph model.
2. **Resolution derives from `package` declarations.** Each `.java` file's
   fully-qualified type name is `<package>.<FileNameWithoutExt>`. The first pass
   builds an `FQN → repo-relative-path` index, so resolving `import com.foo.Bar;`
   is a direct map lookup. No source-root path juggling, build-tool agnostic
   (works for `src/main/java`, custom layouts, multi-module monorepos).
3. **Module = Java package.** For `.java` files the module unit is the package
   (e.g. `com.foo`), not the top-level directory. This is the meaningful Java
   grouping and is what lets wildcard imports resolve to a module node. Files in
   the default package (no `package` declaration) fall back to the existing
   directory-based `detectModule`.
4. **Wildcard imports link to the package `Module`.** `import com.foo.*;`
   resolves to the `Module` node for package `com.foo` (if present in the repo)
   via a `File` -[:IMPORTS]-> `Module` edge. Captures the dependency without
   fabricating false file-to-file edges. Requires no schema change — `IMPORTS`
   is an endpoint-agnostic edge.
5. **Static imports** (`import static com.foo.Bar.method;`) strip the trailing
   member segment and resolve to the class FQN (`com.foo.Bar`).
6. **External/unmatched imports** (`java.util.List`, Spring, etc.) become
   unresolved raw-spec entries on `File.unresolvedImports`, exactly like external
   npm/Composer packages today.
7. **Regex parser, zero new dependencies**, consistent with `ts-imports.ts` and
   `php-imports.ts`. Java import syntax is single-line and unambiguous.

## Components

### `src/languages.ts`
- Add `"java"` to the `Language` union.
- Add `JAVA_EXT = new Set([".java"])` and a `detectLanguage` branch returning
  `"java"`.

### `src/parsers/java-imports.ts` (new)
Comment-stripping first (Java `//` and `/* */`, same as TS — local helper, not
shared, to avoid coupling).

- `parseJavaPackage(source: string): string | null`
  Extracts the package name from `package com.foo.bar;`. Returns `null` if absent
  (default package).
- `parseJavaImports(source: string): JavaImport[]`
  where `interface JavaImport { fqn: string; kind: "single" | "static" | "wildcard" }`.
  - `import com.foo.Bar;` → `{ fqn: "com.foo.Bar", kind: "single" }`
  - `import static com.foo.Bar.method;` → `{ fqn: "com.foo.Bar", kind: "static" }`
    (the trailing member is dropped in the parser, so `fqn` is the class FQN)
  - `import com.foo.*;` → `{ fqn: "com.foo", kind: "wildcard" }`
  - `import static com.foo.Bar.*;` → `{ fqn: "com.foo.Bar", kind: "static" }`
    (static-wildcard imports a class's static members, so the dependency is that
    class's file; the trailing `.*` is dropped just like any other member)

### `src/resolvers/java.ts` (new)
- `javaFqnForFile(relPath: string, pkg: string | null): string`
  Returns `pkg ? "${pkg}.${base}" : base` where `base` is the filename without
  the `.java` extension.
- Resolution helpers (pure functions, consumed by the indexer):
  - **single / static** → look up `fqn` in the FQN index (the parser has already
    reduced static imports to their class FQN, so both are a plain lookup).
  - **wildcard** → the package name is the `fqn` already; the indexer links to
    the package module if it exists.

### `src/writer.ts`
- Add `linkImportsToModule(client, db, fromFilePath, moduleQualified)` —
  `MATCH (a:File {...}) MATCH (m:Module {...}) MERGE (a)-[:IMPORTS]->(m)`.
  No schema change required.

### `src/indexer.ts`
First pass (file/module nodes):
- For `.java` files, parse `package`; module name = package (path
  `${repoName}/${pkg}`), falling back to `detectModule(rel)` when there is no
  package declaration.
- Build `javaTypeIndex: Map<fqn, relPath>` and `javaPackages: Set<string>` (the
  set of package-modules present in the repo).

Second pass (import edges):
- For each `.java` file, `parseJavaImports`. Per import kind:
  - **single / static** → resolve to a file via `javaTypeIndex`; on hit,
    `linkImports(file → file)`.
  - **wildcard** → if `javaPackages.has(pkg)`, `linkImportsToModule(file →
    module)`; else unresolved raw spec.
  - **miss** → `linkImports(file, null, rawSpec)` (stored on
    `unresolvedImports`).

The two-pass data flow is unchanged; Java adds a branch in each pass exactly as
PHP does.

## Edge cases

- **Default package** (no `package` line): module via directory-based
  `detectModule`; FQN is the bare class name.
- **Nested/inner classes**: ignored; imports resolve to the top-level file.
- **Multiple top-level classes in one file**: only the filename-matching type is
  import-addressable (the Java norm); acceptable for a regex indexer.
- **Static wildcard** `import static com.foo.Bar.*;`: the `.*` is dropped and it
  is treated as a `static` import of the class `com.foo.Bar`, resolving to that
  class's file (or unresolved if external). Distinct from a type wildcard
  (`import com.foo.*;`), which targets a package module.
- **External / JDK imports** (`java.util.*`, Spring): no in-repo match → stored
  as unresolved raw spec.

## Testing

Matches the existing vitest layout:

- `tests/parsers/java-imports.test.ts` — package extraction; single, static,
  wildcard imports; comment stripping; default package.
- `tests/resolvers/java.test.ts` — FQN computation; resolution by kind.
- `tests/fixtures/tiny-java/` — a small project with two packages, containing:
  a cross-package single import, a static import, a wildcard import, and an
  external `java.util` import.
- `tests/indexer.test.ts` — integration assertions over the fixture: file/module
  counts, a file→file `IMPORTS` edge, a file→module wildcard edge, and an
  unresolved external spec.
- `tests/languages.test.ts` — `.java` → `"java"`.

## Documentation

- `packages/code-indexer/README.md` — note Java support.
- Root `README.md` — update the language list to "TypeScript / JavaScript / PHP
  / Java".
