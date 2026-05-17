import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findTsconfigs, tsconfigForFile, resolveAlias } from "../../src/resolvers/tsconfig.js";

function makeProject(layout: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "tscfg-test-"));
  for (const [path, content] of Object.entries(layout)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

describe("findTsconfigs", () => {
  it("extracts paths from a root tsconfig.json", async () => {
    const root = makeProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
      }),
      "src/Button.tsx": "",
    });
    const configs = await findTsconfigs(root, ["tsconfig.json", "src/Button.tsx"]);
    expect(configs.size).toBe(1);
    expect(configs.get(".")?.paths).toEqual({ "@/*": ["./src/*"] });
  });

  it("handles tsconfig.json with comments and trailing commas", async () => {
    const root = makeProject({
      "tsconfig.json": `{
        // comments are fine
        "compilerOptions": {
          "paths": { "@/*": ["./src/*"] }, /* trailing comma below */
        },
      }`,
    });
    const configs = await findTsconfigs(root, ["tsconfig.json"]);
    expect(configs.get(".")?.paths).toEqual({ "@/*": ["./src/*"] });
  });

  it("discovers nested tsconfigs in a monorepo", async () => {
    const root = makeProject({
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@root/*": ["./*"] } } }),
      "apps/web/tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
      "apps/web/src/x.tsx": "",
    });
    const configs = await findTsconfigs(root, [
      "tsconfig.json",
      "apps/web/tsconfig.json",
      "apps/web/src/x.tsx",
    ]);
    expect(configs.size).toBe(2);
    expect(configs.get("apps/web")?.paths).toEqual({ "@/*": ["./src/*"] });
  });

  it("silently skips configs with no paths field", async () => {
    const root = makeProject({
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
    });
    const configs = await findTsconfigs(root, ["tsconfig.json"]);
    expect(configs.size).toBe(0);
  });
});

describe("tsconfigForFile", () => {
  it("returns the nearest tsconfig walking up from the file's dir", () => {
    const configs = new Map([
      [".", { configDir: ".", baseUrl: ".", paths: { "@root/*": ["./*"] } }],
      ["apps/web", { configDir: "apps/web", baseUrl: ".", paths: { "@/*": ["./src/*"] } }],
    ]);
    const cfg = tsconfigForFile("apps/web/src/components/Button.tsx", configs);
    expect(cfg?.configDir).toBe("apps/web");
  });

  it("falls back to root when no nested config matches", () => {
    const configs = new Map([
      [".", { configDir: ".", baseUrl: ".", paths: { "@root/*": ["./*"] } }],
    ]);
    const cfg = tsconfigForFile("src/foo.ts", configs);
    expect(cfg?.configDir).toBe(".");
  });

  it("returns null when no config exists at all", () => {
    expect(tsconfigForFile("src/foo.ts", new Map())).toBeNull();
  });
});

describe("resolveAlias", () => {
  it("resolves @/foo to ./src/foo via baseUrl-relative paths", () => {
    const config = { configDir: ".", baseUrl: ".", paths: { "@/*": ["./src/*"] } };
    expect(resolveAlias("@/components/Button", config)).toBe("src/components/Button");
  });

  it("rebases nested-config aliases through configDir", () => {
    const config = { configDir: "apps/web", baseUrl: ".", paths: { "@/*": ["./src/*"] } };
    expect(resolveAlias("@/components/Button", config)).toBe("apps/web/src/components/Button");
  });

  it("returns null when spec doesn't match any pattern", () => {
    const config = { configDir: ".", baseUrl: ".", paths: { "@/*": ["./src/*"] } };
    expect(resolveAlias("react", config)).toBeNull();
  });

  it("handles exact (non-wildcard) patterns", () => {
    const config = { configDir: ".", baseUrl: ".", paths: { "@app": ["./src/app.ts"] } };
    expect(resolveAlias("@app", config)).toBe("src/app.ts");
  });

  it("picks the first target when multiple are configured", () => {
    const config = { configDir: ".", baseUrl: ".", paths: { "@/*": ["./src/*", "./fallback/*"] } };
    expect(resolveAlias("@/x", config)).toBe("src/x");
  });
});
