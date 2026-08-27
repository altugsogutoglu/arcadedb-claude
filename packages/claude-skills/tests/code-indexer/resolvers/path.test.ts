import { describe, it, expect } from "vitest";
import { resolveRelative, resolvePsr4 } from "../../../src/code-indexer/resolvers/path.js";

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
