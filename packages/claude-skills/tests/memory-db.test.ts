import { describe, it, expect } from "vitest";
import { resolveMemoryDb } from "../src/memory-db.js";
import type { ResolvedConfig } from "../src/config.js";
import type { ProjectsMap } from "../src/project-map.js";

function cfg(memoryDb: string, source: "default" | "file" | "env"): ResolvedConfig {
  return {
    httpUri: "http://localhost:2480",
    username: "root",
    password: "",
    memoryDb,
    autoIndex: true,
    envPath: "/tmp/.env",
    sources: { httpUri: "default", username: "default", password: "default", memoryDb: source, autoIndex: "default" },
  };
}

const map: ProjectsMap = { version: 1, defaultMemoryDb: "team_memory", projects: {} };

describe("resolveMemoryDb", () => {
  it("prefers projects.json defaultMemoryDb when ARCADEDB_MEMORY_DB was never set", () => {
    expect(resolveMemoryDb(cfg("claude_memory", "default"), map)).toBe("team_memory");
  });

  it("uses the configured memoryDb when it came from the env file", () => {
    expect(resolveMemoryDb(cfg("other_memory", "file"), map)).toBe("other_memory");
  });

  it("uses the configured memoryDb when it came from the shell environment", () => {
    expect(resolveMemoryDb(cfg("shell_memory", "env"), map)).toBe("shell_memory");
  });
});
