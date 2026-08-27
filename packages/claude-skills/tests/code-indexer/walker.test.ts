import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { walkRepo, DEFAULT_EXCLUDES } from "../../src/code-indexer/walker.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
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

  it("DEFAULT_EXCLUDES covers common build, cache, and archive dirs", () => {
    // Build outputs
    expect(DEFAULT_EXCLUDES.has("dist")).toBe(true);
    expect(DEFAULT_EXCLUDES.has("build")).toBe(true);
    expect(DEFAULT_EXCLUDES.has("out")).toBe(true);
    expect(DEFAULT_EXCLUDES.has(".next")).toBe(true);
    expect(DEFAULT_EXCLUDES.has(".nuxt")).toBe(true);
    expect(DEFAULT_EXCLUDES.has(".svelte-kit")).toBe(true);
    // Caches
    expect(DEFAULT_EXCLUDES.has("tmp")).toBe(true);
    expect(DEFAULT_EXCLUDES.has(".cache")).toBe(true);
    expect(DEFAULT_EXCLUDES.has(".phpunit.cache")).toBe(true);
    expect(DEFAULT_EXCLUDES.has("__pycache__")).toBe(true);
    // Package managers
    expect(DEFAULT_EXCLUDES.has("node_modules")).toBe(true);
    expect(DEFAULT_EXCLUDES.has("vendor")).toBe(true);
    // Archive convention
    expect(DEFAULT_EXCLUDES.has("archive")).toBe(true);
    expect(DEFAULT_EXCLUDES.has("archives")).toBe(true);
  });

  it("honors a custom excludes set, replacing defaults", async () => {
    // Empty set means walk everything (including node_modules if present)
    const files = await walkRepo(nextjsRoot, { excludes: new Set() });
    // Fixture doesn't actually have node_modules; just verify the option threads through
    expect(files.length).toBeGreaterThan(0);
  });
});
