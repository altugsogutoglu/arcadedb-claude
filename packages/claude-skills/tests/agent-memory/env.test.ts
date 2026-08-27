import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "../../src/agent-memory/env.js";

describe("loadEnv", () => {
  let dir: string;
  let envPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arcadedb-env-"));
    envPath = join(dir, ".env");
  });

  it("parses a well-formed .env", () => {
    writeFileSync(envPath, [
      "ARCADEDB_ROOT_PASSWORD=secret",
      "ARCADEDB_HTTP_URI=http://localhost:2480",
      "ARCADEDB_USERNAME=root",
    ].join("\n"));
    const env = loadEnv(envPath);
    expect(env.password).toBe("secret");
    expect(env.httpUri).toBe("http://localhost:2480");
    expect(env.username).toBe("root");
    rmSync(dir, { recursive: true });
  });

  it("throws when password is missing", () => {
    writeFileSync(envPath, "ARCADEDB_HTTP_URI=http://localhost:2480\n");
    expect(() => loadEnv(envPath)).toThrow(/ARCADEDB_ROOT_PASSWORD/);
    rmSync(dir, { recursive: true });
  });

  it("defaults httpUri to localhost:2480 and username to root when missing", () => {
    writeFileSync(envPath, "ARCADEDB_ROOT_PASSWORD=secret\n");
    const env = loadEnv(envPath);
    expect(env.httpUri).toBe("http://localhost:2480");
    expect(env.username).toBe("root");
    rmSync(dir, { recursive: true });
  });
});
