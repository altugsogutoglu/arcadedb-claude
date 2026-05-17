import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { projectsJsonPath, hookErrorLogPath, configDir } from "../src/env-paths.js";

describe("env-paths", () => {
  it("configDir is ~/.config/arcadedb", () => {
    expect(configDir()).toBe(join(homedir(), ".config", "arcadedb"));
  });

  it("projectsJsonPath is ~/.config/arcadedb/projects.json", () => {
    expect(projectsJsonPath()).toBe(join(homedir(), ".config", "arcadedb", "projects.json"));
  });

  it("hookErrorLogPath is ~/.config/arcadedb/hook-errors.log", () => {
    expect(hookErrorLogPath()).toBe(join(homedir(), ".config", "arcadedb", "hook-errors.log"));
  });
});
