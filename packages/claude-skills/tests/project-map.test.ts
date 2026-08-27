import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, mkdirSync, symlinkSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeTempProjectsJson, type TempConfig } from "./helpers/temp-config.js";
import { loadProjects, findProject } from "../src/project-map.js";

describe("loadProjects", () => {
  let tc: TempConfig;
  afterEach(() => tc?.cleanup());

  it("parses a valid projects.json", () => {
    tc = writeTempProjectsJson({
      version: 1,
      defaultMemoryDb: "claude_memory",
      projects: {
        "project-a": { db: "project-a", path: "/tmp/project-a", stack: ["nextjs"], indexLevel: 2, lastIndexed: null },
      },
    });
    const m = loadProjects(tc.path);
    expect(m.defaultMemoryDb).toBe("claude_memory");
    expect(m.projects["project-a"]?.db).toBe("project-a");
  });

  it("returns a default skeleton if the file is missing", () => {
    const m = loadProjects("/tmp/this/path/does/not/exist/projects.json");
    expect(m.defaultMemoryDb).toBe("claude_memory");
    expect(m.projects).toEqual({});
  });

  it("returns default skeleton and invokes onError on malformed JSON", () => {
    tc = writeTempProjectsJson({} as object);
    writeFileSync(tc.path, "{not json");
    const errors: Error[] = [];
    const m = loadProjects(tc.path, err => errors.push(err));
    expect(m.defaultMemoryDb).toBe("claude_memory");
    expect(m.projects).toEqual({});
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain(tc.path);
  });

  it("returns default skeleton silently on malformed JSON when no onError is given", () => {
    tc = writeTempProjectsJson({} as object);
    writeFileSync(tc.path, "{not json");
    const m = loadProjects(tc.path);
    expect(m.defaultMemoryDb).toBe("claude_memory");
    expect(m.projects).toEqual({});
  });
});

describe("findProject", () => {
  const sample = {
    version: 1 as const,
    defaultMemoryDb: "claude_memory",
    projects: {
      "project-a": { db: "project-a", path: "/Users/u/code/project-a", stack: ["nextjs"], indexLevel: 2, lastIndexed: null },
      "project-b": { db: "project-b", path: "/Users/u/code/project-b", stack: ["laravel"], indexLevel: 2, lastIndexed: null },
    },
  };

  it("matches by exact CWD path", () => {
    const result = findProject(sample, "/Users/u/code/project-a", null);
    expect(result?.key).toBe("project-a");
  });

  it("matches by basename when path does not match exactly", () => {
    const result = findProject(sample, "/elsewhere/project-b", null);
    expect(result?.key).toBe("project-b");
  });

  it("matches by git remote (basename of repo URL)", () => {
    const result = findProject(sample, "/totally/different/path", "git@github.com:someone/project-a.git");
    expect(result?.key).toBe("project-a");
  });

  it("returns null when nothing matches", () => {
    const result = findProject(sample, "/nope", "git@github.com:other/other.git");
    expect(result).toBeNull();
  });
});

describe("findProject through symlinks", () => {
  it("matches a registered path reached through a symlinked directory", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "arcadedb-symlink-")));
    const real = join(base, "real-repo");
    const link = join(base, "linked-repo");
    mkdirSync(real);
    symlinkSync(real, link);
    try {
      const map = {
        version: 1 as const,
        defaultMemoryDb: "claude_memory",
        projects: {
          "some-key": { db: "some_key", path: real, stack: [], indexLevel: 0, lastIndexed: null },
        },
      };
      // Neither the basename ("linked-repo") nor a remote can rescue this: only realpath can.
      const result = findProject(map, link, null);
      expect(result?.key).toBe("some-key");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("still returns null when the paths are genuinely different", () => {
    const map = {
      version: 1 as const,
      defaultMemoryDb: "claude_memory",
      projects: { a: { db: "a", path: "/does/not/exist/a", stack: [], indexLevel: 0, lastIndexed: null } },
    };
    expect(findProject(map, "/does/not/exist/b", null)).toBeNull();
  });
});
