import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const tsxBin = require.resolve("tsx/cli");
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CLI = join(__dirname, "..", "bin", "arcadedb-skills.ts");

function runCli(args: string[], env: Record<string, string>): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise(resolve => {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("ARCADEDB_")) clean[k] = v;
    const child = spawn("node", [tsxBin, CLI, ...args], { env: { ...clean, ...env } });
    let stdout = "", stderr = "";
    child.stdout.on("data", d => { stdout += d; }); child.stderr.on("data", d => { stderr += d; });
    child.on("close", code => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "cfg-cli-")); mkdirSync(join(home, ".config", "arcadedb"), { recursive: true }); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

describe("arcadedb-skills config", () => {
  it("set server validates and writes .env; invalid value exits 1", async () => {
    const bad = await runCli(["config", "set", "server", "localhost"], { HOME: home });
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("invalid value for server");
    const ok = await runCli(["config", "set", "server", "http://127.0.0.1:1"], { HOME: home });
    expect(ok.code).toBe(0);
    expect(readFileSync(join(home, ".config", "arcadedb", ".env"), "utf8")).toContain("ARCADEDB_HTTP_URI=http://127.0.0.1:1");
    expect(ok.stdout).toContain("server not reachable at http://127.0.0.1:1");
  });
  it("set auto-index accepts on|off only", async () => {
    expect((await runCli(["config", "set", "auto-index", "maybe"], { HOME: home })).code).toBe(1);
    expect((await runCli(["config", "set", "auto-index", "off"], { HOME: home })).code).toBe(0);
    expect(readFileSync(join(home, ".config", "arcadedb", ".env"), "utf8")).toContain("ARCADEDB_AUTO_INDEX=off");
  });
  it("show masks the password and reports sources", async () => {
    writeFileSync(join(home, ".config", "arcadedb", ".env"), "ARCADEDB_HTTP_URI=http://127.0.0.1:1\nARCADEDB_ROOT_PASSWORD=secret\n");
    const r = await runCli(["config", "show"], { HOME: home });
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("secret");
    expect(r.stdout).toContain("password:   ********");
    expect(r.stdout).toMatch(/server: +http:\/\/127\.0\.0\.1:1 +\(file\)/);
    expect(r.stdout).toMatch(/user: +root +\(default\)/);
    expect(r.stdout).toContain("Projects (0)");
  });
  it("test prints the probe result", async () => {
    writeFileSync(join(home, ".config", "arcadedb", ".env"), "ARCADEDB_HTTP_URI=http://127.0.0.1:1\nARCADEDB_ROOT_PASSWORD=x\n");
    const r = await runCli(["config", "test"], { HOME: home });
    expect(r.stdout).toContain("server not reachable");
  });
  it("forget removes a registry entry", async () => {
    writeFileSync(join(home, ".config", "arcadedb", "projects.json"), JSON.stringify({ version: 1, defaultMemoryDb: "claude_memory", projects: { a: { db: "a", path: "/a", stack: [], indexLevel: 0, lastIndexed: null }, b: { db: "b", path: "/b", stack: [], indexLevel: 0, lastIndexed: null } } }));
    const r = await runCli(["config", "forget", "a"], { HOME: home });
    expect(r.code).toBe(0);
    const projects = JSON.parse(readFileSync(join(home, ".config", "arcadedb", "projects.json"), "utf8")).projects;
    expect(Object.keys(projects)).toEqual(["b"]);
    expect((await runCli(["config", "forget", "zzz"], { HOME: home })).code).toBe(1);
  });
  it("index on an unregistered cwd exits 1 with guidance", async () => {
    const r = await runCli(["config", "index"], { HOME: home, PWD: "/nonexistent/dir" });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("not registered");
  });
  it("forget --drop-db refuses an unsafe database name and leaves the entry", async () => {
    writeFileSync(join(home, ".config", "arcadedb", "projects.json"), JSON.stringify({ version: 1, defaultMemoryDb: "claude_memory", projects: { a: { db: "x; drop database claude_memory", path: "/a", stack: [], indexLevel: 0, lastIndexed: null } } }));
    const r = await runCli(["config", "forget", "a", "--drop-db"], { HOME: home });
    expect(r.code).toBe(1);
    const projects = JSON.parse(readFileSync(join(home, ".config", "arcadedb", "projects.json"), "utf8")).projects;
    expect(Object.keys(projects)).toEqual(["a"]);
  });
  it("set rejects values with line breaks", async () => {
    const r = await runCli(["config", "set", "user", "a\nb"], { HOME: home });
    expect(r.code).toBe(1);
  });
});
