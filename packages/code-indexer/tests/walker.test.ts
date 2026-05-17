import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { walkRepo } from "../src/walker.js";

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
});
