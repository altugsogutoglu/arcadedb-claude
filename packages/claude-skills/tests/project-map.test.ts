import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
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

  it("throws on malformed JSON", () => {
    tc = writeTempProjectsJson({} as object);
    writeFileSync(tc.path, "{not json");
    expect(() => loadProjects(tc.path)).toThrow();
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
