import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findComposers, composerForFile } from "../../../src/code-indexer/resolvers/composer.js";

function makeProject(layout: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "composer-test-"));
  for (const [path, content] of Object.entries(layout)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

describe("findComposers", () => {
  it("rebases psr-4 targets relative to project root, not composer.json dir", async () => {
    const root = makeProject({
      "backend/composer.json": JSON.stringify({
        autoload: { "psr-4": { "App\\": "app/", "Packages\\Foo\\": "packages/foo/src/" } },
      }),
    });
    const composers = await findComposers(root, ["backend/composer.json"]);
    const c = composers.get("backend");
    expect(c?.psr4).toEqual({
      "App\\": "backend/app/",
      "Packages\\Foo\\": "backend/packages/foo/src/",
    });
  });

  it("merges autoload-dev into the same map", async () => {
    const root = makeProject({
      "composer.json": JSON.stringify({
        autoload: { "psr-4": { "App\\": "app/" } },
        "autoload-dev": { "psr-4": { "Tests\\": "tests/" } },
      }),
    });
    const composers = await findComposers(root, ["composer.json"]);
    const c = composers.get(".");
    expect(c?.psr4).toEqual({ "App\\": "app/", "Tests\\": "tests/" });
  });

  it("skips composer.json files with no psr-4 entries", async () => {
    const root = makeProject({
      "composer.json": JSON.stringify({ require: { "php": ">=8.2" } }),
    });
    const composers = await findComposers(root, ["composer.json"]);
    expect(composers.size).toBe(0);
  });

  it("discovers nested composer.json files in a monorepo", async () => {
    const root = makeProject({
      "composer.json": JSON.stringify({ autoload: { "psr-4": { "Root\\": "src/" } } }),
      "backend/composer.json": JSON.stringify({ autoload: { "psr-4": { "App\\": "app/" } } }),
    });
    const composers = await findComposers(root, ["composer.json", "backend/composer.json"]);
    expect(composers.size).toBe(2);
    expect(composers.get(".")?.psr4).toEqual({ "Root\\": "src/" });
    expect(composers.get("backend")?.psr4).toEqual({ "App\\": "backend/app/" });
  });
});

describe("composerForFile", () => {
  it("returns the nearest composer walking up from the file's dir", () => {
    const composers = new Map([
      [".", { composerDir: ".", psr4: { "Root\\": "src/" } }],
      ["backend", { composerDir: "backend", psr4: { "App\\": "backend/app/" } }],
    ]);
    const c = composerForFile("backend/app/Models/User.php", composers);
    expect(c?.composerDir).toBe("backend");
  });

  it("returns null when no composer exists", () => {
    expect(composerForFile("src/foo.php", new Map())).toBeNull();
  });
});
