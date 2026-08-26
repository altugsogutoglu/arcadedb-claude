import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig, readEnvFile, writeEnvFile, ensureEnvFile, toClientEnv, DEFAULTS } from "../src/config.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "arcadedb-cfg-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("resolveConfig", () => {
  it("returns defaults with empty password when nothing is configured", () => {
    const cfg = resolveConfig({ envPath: join(dir, ".env"), processEnv: {} });
    expect(cfg.httpUri).toBe(DEFAULTS.httpUri);
    expect(cfg.username).toBe("root");
    expect(cfg.password).toBe("");
    expect(cfg.memoryDb).toBe("claude_memory");
    expect(cfg.autoIndex).toBe(true);
    expect(cfg.sources.httpUri).toBe("default");
  });
  it("file overrides defaults", () => {
    writeFileSync(join(dir, ".env"), "ARCADEDB_HTTP_URI=http://db:9999\nARCADEDB_ROOT_PASSWORD=pw\nARCADEDB_AUTO_INDEX=off\n");
    const cfg = resolveConfig({ envPath: join(dir, ".env"), processEnv: {} });
    expect(cfg.httpUri).toBe("http://db:9999");
    expect(cfg.password).toBe("pw");
    expect(cfg.autoIndex).toBe(false);
    expect(cfg.sources.httpUri).toBe("file");
    expect(cfg.sources.username).toBe("default");
  });
  it("process env overrides file", () => {
    writeFileSync(join(dir, ".env"), "ARCADEDB_HTTP_URI=http://db:9999\nARCADEDB_ROOT_PASSWORD=pw\n");
    const cfg = resolveConfig({ envPath: join(dir, ".env"), processEnv: { ARCADEDB_HTTP_URI: "http://env:1", ARCADEDB_MEMORY_DB: "mem2" } });
    expect(cfg.httpUri).toBe("http://env:1");
    expect(cfg.sources.httpUri).toBe("env");
    expect(cfg.memoryDb).toBe("mem2");
    expect(cfg.password).toBe("pw");
  });
  it("toClientEnv returns the three client fields", () => {
    const cfg = resolveConfig({ envPath: join(dir, ".env"), processEnv: { ARCADEDB_ROOT_PASSWORD: "x" } });
    expect(toClientEnv(cfg)).toEqual({ httpUri: DEFAULTS.httpUri, username: "root", password: "x" });
  });
});

describe("env file", () => {
  it("readEnvFile returns {} when missing and parses key=value ignoring comments", () => {
    expect(readEnvFile(join(dir, "nope"))).toEqual({});
    writeFileSync(join(dir, ".env"), "# c\nA=1\nB = two \n\nbad\n");
    expect(readEnvFile(join(dir, ".env"))).toEqual({ A: "1", B: "two" });
  });
  it("ensureEnvFile creates defaults with empty password, mode 600, and never overwrites", () => {
    const p = join(dir, ".env");
    expect(ensureEnvFile(p)).toBe(true);
    const text = readFileSync(p, "utf8");
    expect(text).toContain("ARCADEDB_HTTP_URI=http://localhost:2480");
    expect(text).toContain("ARCADEDB_USERNAME=root");
    expect(text).toContain("ARCADEDB_ROOT_PASSWORD=");
    expect(statSync(p).mode & 0o777).toBe(0o600);
    writeFileSync(p, "ARCADEDB_ROOT_PASSWORD=keep\n");
    expect(ensureEnvFile(p)).toBe(false);
    expect(readFileSync(p, "utf8")).toBe("ARCADEDB_ROOT_PASSWORD=keep\n");
  });
  it("writeEnvFile merges, preserves unknown keys, is atomic, mode 600", () => {
    const p = join(dir, ".env");
    writeFileSync(p, "CUSTOM=1\nARCADEDB_ROOT_PASSWORD=old\n");
    writeEnvFile({ ARCADEDB_ROOT_PASSWORD: "new", ARCADEDB_HTTP_URI: "http://h:1" }, p);
    const map = readEnvFile(p);
    expect(map).toEqual({ CUSTOM: "1", ARCADEDB_ROOT_PASSWORD: "new", ARCADEDB_HTTP_URI: "http://h:1" });
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(existsSync(p + ".tmp")).toBe(false);
  });
});
