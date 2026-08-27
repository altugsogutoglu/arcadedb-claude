import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markProjectIndexed } from "../../src/code-indexer/projects-config.js";

let tmp: string;
let configPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "arcadedb-projects-"));
  configPath = join(tmp, "projects.json");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const FIXED_NOW = () => "2026-05-17T20:00:00.000Z";

describe("markProjectIndexed", () => {
  it("writes lastIndexed when project matches by db name", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        version: 1,
        projects: {
          "my-app": { db: "my_app", path: "/some/other/path", lastIndexed: null },
        },
      }),
    );

    const matched = markProjectIndexed("my_app", "/unrelated", configPath, FIXED_NOW);

    expect(matched).toBe("my-app");
    const updated = JSON.parse(readFileSync(configPath, "utf8"));
    expect(updated.projects["my-app"].lastIndexed).toBe("2026-05-17T20:00:00.000Z");
  });

  it("matches by path when db does not match", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        version: 1,
        projects: {
          "my-app": { db: "different_db", path: "/repos/my-app", lastIndexed: null },
        },
      }),
    );

    const matched = markProjectIndexed("ad_hoc_db", "/repos/my-app", configPath, FIXED_NOW);

    expect(matched).toBe("my-app");
    const updated = JSON.parse(readFileSync(configPath, "utf8"));
    expect(updated.projects["my-app"].lastIndexed).toBe("2026-05-17T20:00:00.000Z");
  });

  it("returns null and writes nothing when no project matches", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        version: 1,
        projects: {
          "my-app": { db: "my_app", path: "/repos/my-app", lastIndexed: null },
        },
      }),
    );
    const before = readFileSync(configPath, "utf8");

    const matched = markProjectIndexed("ghost_db", "/no/match", configPath, FIXED_NOW);

    expect(matched).toBeNull();
    expect(readFileSync(configPath, "utf8")).toBe(before);
  });

  it("no-ops silently when config file is missing", () => {
    const matched = markProjectIndexed("any", "/any", join(tmp, "does-not-exist.json"), FIXED_NOW);
    expect(matched).toBeNull();
  });

  it("no-ops silently when config file is malformed", () => {
    writeFileSync(configPath, "{ not json");
    const matched = markProjectIndexed("any", "/any", configPath, FIXED_NOW);
    expect(matched).toBeNull();
    expect(existsSync(configPath)).toBe(true);
  });

  it("preserves other project entries untouched", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        version: 1,
        projects: {
          "a": { db: "a_db", path: "/a", lastIndexed: "2026-01-01T00:00:00.000Z" },
          "b": { db: "b_db", path: "/b", lastIndexed: null },
        },
      }),
    );

    markProjectIndexed("a_db", "/a", configPath, FIXED_NOW);

    const updated = JSON.parse(readFileSync(configPath, "utf8"));
    expect(updated.projects.a.lastIndexed).toBe("2026-05-17T20:00:00.000Z");
    expect(updated.projects.b.lastIndexed).toBeNull();
  });
});
