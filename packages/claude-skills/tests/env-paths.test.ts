import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { projectsJsonPath, hookErrorLogPath, configDir, sessionsDir, sessionStatePath } from "../src/env-paths.js";

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

describe("session paths", () => {
  it("sessionsDir is ~/.config/arcadedb/sessions", () => {
    expect(sessionsDir()).toBe(join(homedir(), ".config", "arcadedb", "sessions"));
  });

  it("sessionStatePath is ~/.config/arcadedb/sessions/<id>.json", () => {
    expect(sessionStatePath("cc-123")).toBe(join(homedir(), ".config", "arcadedb", "sessions", "cc-123.json"));
  });
});
