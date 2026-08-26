# Plug-and-Play Plugin (0.7.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After installing the plugin and running an ArcadeDB server, every git repo gets memory capture and a code graph with zero commands; `/arcadedb-config` is the only knob.

**Architecture:** SessionStart becomes a bootstrap: resolve config (env > `.env` > defaults), probe the server, ensure `claude_memory` schemas, auto-register the repo (0.6.2), and spawn a detached background indexer when the graph is missing or stale. A `config` subcommand family in the bundled `hooks/cli.js` backs a new `/arcadedb-config` command; `/arcadedb-init` is removed. The indexer ships as a second self-contained bundle `hooks/index.js`.

**Tech Stack:** TypeScript (ESM, Node 20), vitest, esbuild bundles under `packages/claude-skills/hooks/`, ArcadeDB HTTP API via `arcadedb-agent-memory` `Client`, `arcadedb-code-indexer` `indexRepo()` (workspace package, zero external deps).

**Spec:** `docs/superpowers/specs/2026-08-27-plug-and-play-design.md`

## Global Constraints

- Node `>=20`, ESM, `.js` import suffix. Run commands from `packages/claude-skills`. Unit: `npx vitest run tests/<file>`; full `npm test` needs a live ArcadeDB (`~/.config/arcadedb/.env`).
- Hooks never crash the session: keep `main().catch(err => { logError(err); process.exit(0); })`.
- Installed plugin has no `node_modules` and no `dist/`; anything that runs at session time is a committed esbuild bundle under `hooks/`. New bundle: `hooks/index.js`.
- Setting precedence, exact: process env `ARCADEDB_*` > `~/.config/arcadedb/.env` > defaults `http://localhost:2480`, `root`, `claude_memory`, auto-index on.
- `.env` file mode `600`, written atomically (tmp + rename), unknown keys preserved. Password never printed (mask as `********`), never logged.
- Banner strings, exact:
  - ok: `  Server: <httpUri> (ok, <n> ms)`
  - unreachable: `ArcadeDB: server not reachable at <httpUri>. Start ArcadeDB or run: /arcadedb-config set server http://host:port`
  - no_password: `ArcadeDB: server reachable at <httpUri> but no password configured. Run: /arcadedb-config set password <root-password>`
  - unauthorized: `ArcadeDB: authentication failed at <httpUri> for user <username>. Run: /arcadedb-config set password <root-password>`
  - each failure banner is followed by the line `  Capture and code graph are off until then.`
- capture.log events added: `server_unavailable {status, httpUri}`, `memory_schema_failed {error}`, `index_started {key, db, pid}`, `index_done {key, files, imports, unresolved, ms}`, `index_failed {key, error}`, `index_skipped_too_large {key, files}`, `index_skipped_running {key}`.
- Index size guard: skip when `git ls-files` in the repo root lists more than `20000` files.
- No em-dashes (U+2014) in any text, code, or docs.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01DxB2h24YR4BH5CP9uVgivs
  ```

## Known state of the code (read before Task 1)

- `src/session-start.ts` (0.6.2): reads hook stdin, `loadEnv()` from `arcadedb-agent-memory` (throws if `.env` missing, so today the hook exits silently with no banner), auto-registers via `src/auto-register.ts` (`deriveProjectIdentity`, `detectStack`, `registerProject`, `gitToplevel`, `RegistrationError`, `MEMORY_DB_COLLISION`), builds the banner with `buildContext()` from `src/context-builder.ts`, starts a `:Session` and writes state via `src/session-state.ts`.
- `src/capture-log.ts`: `logCapture(event, fields)`. `src/env-paths.ts`: `configDir()`, `projectsJsonPath()`, `hookErrorLogPath()`, `sessionsDir()`, `sessionStatePath(id)`, `dryrunPath()`, `extractorErrorsPath()`, `captureLogPath()`.
- `src/project-map.ts`: `ProjectEntry { db, path, stack, indexLevel, lastIndexed }`, `loadProjects(path, onError?)`, `findProject(map, cwd, remote)`.
- `src/post-tool-use.ts` appends `[<iso>] <key> (cwd=<cwd>)` to `~/.config/arcadedb/stale.log` on every Edit/Write in a registered project.
- `bin/arcadedb-skills.ts`: commands `mark-extracted`, `extract-write`, `extractor-prompt`; bundled to `hooks/cli.js` by `npm run bundle:hooks`.
- `arcadedb-agent-memory`: `Client(env: { httpUri, username, password })` with `query`, `execute`, `command`, `listDatabases`; `applySchemas(client, db, domains)` creates the DB if missing; `loadEnv(path?)`.
- `arcadedb-code-indexer`: `indexRepo(client, rootAbsPath, { db, autoMigrate?, stack?, extraExcludes?, noDefaultExcludes? }) => Promise<IndexSummary { repo, files, totalFiles, imports, unresolved }>`; exported from its `src/index.ts`. Zero external deps, so esbuild can bundle it.
- Tests: `tests/session-start.test.ts` has `runWithStdin(script, stdin, env)`; `tests/helpers/temp-db.ts` exports `createTempDb(prefix)` and `env`. Command markdown is checked by `tests/skills-commands.test.ts`; plugin files by `tests/plugin-manifest.test.ts`; hook bundles by `tests/hooks-wiring.test.ts`.

## File Structure

- Create `src/config.ts`: config resolution + `.env` read/write.
- Create `src/server-probe.ts`: reachability + auth probe.
- Create `src/index-need.ts`: pure decision "does this project need (re)indexing" from `ProjectEntry` + `stale.log`.
- Create `src/index-runner.ts`: entry for the `hooks/index.js` bundle (lock, size guard, `indexRepo`, registry update, logs).
- Create `src/index-spawn.ts`: detached spawn of the runner from SessionStart.
- Create `src/config-cli.ts`: `config show|set|test|forget|index` handlers used by `bin/arcadedb-skills.ts`.
- Modify `src/session-start.ts`: bootstrap order from the spec.
- Modify `src/context-builder.ts`: server line + indexing-in-background wording.
- Modify `src/auto-register.ts`: add `updateProject(projectsPath, key, patch)` (atomic) reused by the runner and `config forget`.
- Modify `bin/arcadedb-skills.ts`: wire `config` subcommands.
- Modify `package.json`: bundle `src/index-runner.ts` to `hooks/index.js`; add devDependency `arcadedb-code-indexer`.
- Create `commands/arcadedb-config.md`; delete `commands/arcadedb-init.md`; modify `commands/graph-index.md`, `commands/graph-status.md`; modify `README.md` quick start.
- Tests: one file per new module plus extensions of `session-start`, `stop`, `context-builder`, `skills-commands`, `hooks-wiring`, `index-barrel`.

---

### Task 1: Config resolution and `.env` writer

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ConfigSource = "default" | "file" | "env";
  export interface ResolvedConfig {
    httpUri: string; username: string; password: string; memoryDb: string; autoIndex: boolean;
    envPath: string;
    sources: { httpUri: ConfigSource; username: ConfigSource; password: ConfigSource; memoryDb: ConfigSource; autoIndex: ConfigSource };
  }
  export const DEFAULTS = { httpUri: "http://localhost:2480", username: "root", memoryDb: "claude_memory", autoIndex: true };
  export function envFilePath(): string;                       // ~/.config/arcadedb/.env
  export function readEnvFile(path?: string): Record<string, string>;  // {} when missing
  export function writeEnvFile(values: Record<string, string>, path?: string): void; // merge, atomic, mode 600
  export function ensureEnvFile(path?: string): boolean;        // creates defaults file if absent; true if created
  export function resolveConfig(opts?: { envPath?: string; processEnv?: NodeJS.ProcessEnv }): ResolvedConfig;
  export function toClientEnv(cfg: ResolvedConfig): { httpUri: string; username: string; password: string };
  ```
- Keys in `.env`: `ARCADEDB_HTTP_URI`, `ARCADEDB_USERNAME`, `ARCADEDB_ROOT_PASSWORD`, `ARCADEDB_MEMORY_DB`, `ARCADEDB_AUTO_INDEX` (`on|off`). Same names read from process env.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/config.test.ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL, cannot find module `../src/config.js`.

- [ ] **Step 3: Implement**

```ts
// src/config.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { configDir } from "./env-paths.js";

export type ConfigSource = "default" | "file" | "env";

export interface ResolvedConfig {
  httpUri: string;
  username: string;
  password: string;
  memoryDb: string;
  autoIndex: boolean;
  envPath: string;
  sources: {
    httpUri: ConfigSource;
    username: ConfigSource;
    password: ConfigSource;
    memoryDb: ConfigSource;
    autoIndex: ConfigSource;
  };
}

export const DEFAULTS = {
  httpUri: "http://localhost:2480",
  username: "root",
  memoryDb: "claude_memory",
  autoIndex: true,
} as const;

const KEYS = {
  httpUri: "ARCADEDB_HTTP_URI",
  username: "ARCADEDB_USERNAME",
  password: "ARCADEDB_ROOT_PASSWORD",
  memoryDb: "ARCADEDB_MEMORY_DB",
  autoIndex: "ARCADEDB_AUTO_INDEX",
} as const;

export function envFilePath(): string {
  return join(configDir(), ".env");
}

export function readEnvFile(path: string = envFilePath()): Record<string, string> {
  if (!existsSync(path)) return {};
  const map: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    map[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return map;
}

export function writeEnvFile(values: Record<string, string>, path: string = envFilePath()): void {
  const merged = { ...readEnvFile(path), ...values };
  const body = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

export function ensureEnvFile(path: string = envFilePath()): boolean {
  if (existsSync(path)) return false;
  writeEnvFile({
    [KEYS.httpUri]: DEFAULTS.httpUri,
    [KEYS.username]: DEFAULTS.username,
    [KEYS.password]: "",
  }, path);
  return true;
}

function pick(
  key: string,
  processEnv: NodeJS.ProcessEnv,
  file: Record<string, string>,
  fallback: string,
): { value: string; source: ConfigSource } {
  const fromEnv = processEnv[key];
  if (fromEnv !== undefined && fromEnv !== "") return { value: fromEnv, source: "env" };
  const fromFile = file[key];
  if (fromFile !== undefined && fromFile !== "") return { value: fromFile, source: "file" };
  return { value: fallback, source: "default" };
}

export function resolveConfig(opts: { envPath?: string; processEnv?: NodeJS.ProcessEnv } = {}): ResolvedConfig {
  const envPath = opts.envPath ?? envFilePath();
  const processEnv = opts.processEnv ?? process.env;
  const file = readEnvFile(envPath);
  const httpUri = pick(KEYS.httpUri, processEnv, file, DEFAULTS.httpUri);
  const username = pick(KEYS.username, processEnv, file, DEFAULTS.username);
  const password = pick(KEYS.password, processEnv, file, "");
  const memoryDb = pick(KEYS.memoryDb, processEnv, file, DEFAULTS.memoryDb);
  const autoIndexRaw = pick(KEYS.autoIndex, processEnv, file, DEFAULTS.autoIndex ? "on" : "off");
  return {
    httpUri: httpUri.value.replace(/\/+$/, ""),
    username: username.value,
    password: password.value,
    memoryDb: memoryDb.value,
    autoIndex: autoIndexRaw.value.toLowerCase() !== "off",
    envPath,
    sources: {
      httpUri: httpUri.source,
      username: username.source,
      password: password.source,
      memoryDb: memoryDb.source,
      autoIndex: autoIndexRaw.source,
    },
  };
}

export function toClientEnv(cfg: ResolvedConfig): { httpUri: string; username: string; password: string } {
  return { httpUri: cfg.httpUri, username: cfg.username, password: cfg.password };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skills/src/config.ts packages/claude-skills/tests/config.test.ts
git commit -m "feat(claude-skills): config resolution with env > .env > defaults"
```

---

### Task 2: Server probe

**Files:**
- Create: `src/server-probe.ts`
- Test: `tests/server-probe.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ProbeStatus = "ok" | "unreachable" | "no_password" | "unauthorized";
  export interface ProbeResult { status: ProbeStatus; httpUri: string; latencyMs: number; detail?: string }
  export async function probeServer(cfg: { httpUri: string; username: string; password: string }, timeoutMs?: number): Promise<ProbeResult>;
  export function probeBanner(r: ProbeResult, username: string): string[]; // lines per Global Constraints
  ```
- Logic: `GET <httpUri>/api/v1/ready` (no auth, 2 s timeout). Non-2xx or network error → `unreachable`. Then if `password === ""` → `no_password` (no auth call). Else `GET /api/v1/databases` with basic auth; 401/403 → `unauthorized`; 2xx → `ok`; other → `unreachable` with `detail`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/server-probe.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { probeServer, probeBanner } from "../src/server-probe.js";

let server: Server | null = null;
afterEach(async () => { if (server) await new Promise(r => server!.close(r)); server = null; });

function listen(handler: (path: string, auth: string | undefined, res: import("node:http").ServerResponse) => void): Promise<string> {
  return new Promise(resolve => {
    server = createServer((req, res) => handler(req.url ?? "", req.headers.authorization, res));
    server.listen(0, "127.0.0.1", () => {
      const addr = server!.address() as { port: number };
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

describe("probeServer", () => {
  it("ok when ready and databases authorizes", async () => {
    const uri = await listen((path, auth, res) => {
      if (path === "/api/v1/ready") { res.writeHead(204); res.end(); return; }
      if (path === "/api/v1/databases") {
        const expected = "Basic " + Buffer.from("root:pw").toString("base64");
        res.writeHead(auth === expected ? 200 : 401, { "content-type": "application/json" });
        res.end(JSON.stringify({ result: ["claude_memory"] }));
        return;
      }
      res.writeHead(404); res.end();
    });
    const r = await probeServer({ httpUri: uri, username: "root", password: "pw" });
    expect(r.status).toBe("ok");
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });
  it("unauthorized on 401", async () => {
    const uri = await listen((path, _auth, res) => {
      if (path === "/api/v1/ready") { res.writeHead(204); res.end(); return; }
      res.writeHead(401); res.end();
    });
    expect((await probeServer({ httpUri: uri, username: "root", password: "bad" })).status).toBe("unauthorized");
  });
  it("no_password when ready but password empty, without calling databases", async () => {
    let dbCalls = 0;
    const uri = await listen((path, _auth, res) => {
      if (path === "/api/v1/databases") dbCalls++;
      res.writeHead(204); res.end();
    });
    expect((await probeServer({ httpUri: uri, username: "root", password: "" })).status).toBe("no_password");
    expect(dbCalls).toBe(0);
  });
  it("unreachable when nothing listens", async () => {
    const r = await probeServer({ httpUri: "http://127.0.0.1:1", username: "root", password: "pw" }, 500);
    expect(r.status).toBe("unreachable");
  });
});

describe("probeBanner", () => {
  it("renders the exact lines per status", () => {
    expect(probeBanner({ status: "ok", httpUri: "http://h:1", latencyMs: 12 }, "root")).toEqual(["  Server: http://h:1 (ok, 12 ms)"]);
    expect(probeBanner({ status: "unreachable", httpUri: "http://h:1", latencyMs: 0 }, "root")).toEqual([
      "ArcadeDB: server not reachable at http://h:1. Start ArcadeDB or run: /arcadedb-config set server http://host:port",
      "  Capture and code graph are off until then.",
    ]);
    expect(probeBanner({ status: "no_password", httpUri: "http://h:1", latencyMs: 0 }, "root")).toEqual([
      "ArcadeDB: server reachable at http://h:1 but no password configured. Run: /arcadedb-config set password <root-password>",
      "  Capture and code graph are off until then.",
    ]);
    expect(probeBanner({ status: "unauthorized", httpUri: "http://h:1", latencyMs: 0 }, "root")).toEqual([
      "ArcadeDB: authentication failed at http://h:1 for user root. Run: /arcadedb-config set password <root-password>",
      "  Capture and code graph are off until then.",
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/server-probe.test.ts`
Expected: FAIL, missing module.

- [ ] **Step 3: Implement**

```ts
// src/server-probe.ts
export type ProbeStatus = "ok" | "unreachable" | "no_password" | "unauthorized";

export interface ProbeResult {
  status: ProbeStatus;
  httpUri: string;
  latencyMs: number;
  detail?: string;
}

async function get(url: string, headers: Record<string, string>, timeoutMs: number): Promise<{ status: number } | { error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    return { status: res.status };
  } catch (e) {
    return { error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeServer(
  cfg: { httpUri: string; username: string; password: string },
  timeoutMs = 2000,
): Promise<ProbeResult> {
  const started = Date.now();
  const ready = await get(`${cfg.httpUri}/api/v1/ready`, {}, timeoutMs);
  if ("error" in ready || ready.status < 200 || ready.status >= 300) {
    return { status: "unreachable", httpUri: cfg.httpUri, latencyMs: Date.now() - started, detail: "error" in ready ? ready.error : `HTTP ${ready.status}` };
  }
  if (cfg.password === "") {
    return { status: "no_password", httpUri: cfg.httpUri, latencyMs: Date.now() - started };
  }
  const auth = "Basic " + Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");
  const dbs = await get(`${cfg.httpUri}/api/v1/databases`, { Authorization: auth }, timeoutMs);
  const latencyMs = Date.now() - started;
  if ("error" in dbs) return { status: "unreachable", httpUri: cfg.httpUri, latencyMs, detail: dbs.error };
  if (dbs.status === 401 || dbs.status === 403) return { status: "unauthorized", httpUri: cfg.httpUri, latencyMs };
  if (dbs.status >= 200 && dbs.status < 300) return { status: "ok", httpUri: cfg.httpUri, latencyMs };
  return { status: "unreachable", httpUri: cfg.httpUri, latencyMs, detail: `HTTP ${dbs.status}` };
}

const OFF_LINE = "  Capture and code graph are off until then.";

export function probeBanner(r: ProbeResult, username: string): string[] {
  switch (r.status) {
    case "ok":
      return [`  Server: ${r.httpUri} (ok, ${r.latencyMs} ms)`];
    case "unreachable":
      return [`ArcadeDB: server not reachable at ${r.httpUri}. Start ArcadeDB or run: /arcadedb-config set server http://host:port`, OFF_LINE];
    case "no_password":
      return [`ArcadeDB: server reachable at ${r.httpUri} but no password configured. Run: /arcadedb-config set password <root-password>`, OFF_LINE];
    case "unauthorized":
      return [`ArcadeDB: authentication failed at ${r.httpUri} for user ${username}. Run: /arcadedb-config set password <root-password>`, OFF_LINE];
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/server-probe.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skills/src/server-probe.ts packages/claude-skills/tests/server-probe.test.ts
git commit -m "feat(claude-skills): ArcadeDB server probe with exact banner lines"
```

---

### Task 3: SessionStart bootstrap (config, probe, memory schemas)

**Files:**
- Modify: `src/session-start.ts` (top of `main()`, banner assembly)
- Modify: `src/context-builder.ts` (add `serverLine?: string` to `ContextInput`, printed right after the header)
- Test: `tests/session-start.test.ts` (append), `tests/context-builder.test.ts` (append)

**Interfaces:**
- Consumes: `ensureEnvFile`, `resolveConfig`, `toClientEnv` (Task 1); `probeServer`, `probeBanner` (Task 2); `applySchemas`, `Client` from `arcadedb-agent-memory`; `logCapture`.
- Produces: SessionStart output begins with `ArcadeDB context loaded:` then the server line when ok; on any non-ok probe the output is exactly the two failure lines from `probeBanner` and nothing else, and no state file, no `:Session`, no registration happens.
- Tests may point the hook at a temp `.env` by setting `HOME` (as existing tests do); `ARCADEDB_*` process env must be stripped in the child env for the "cold" cases so it does not override the temp file.

- [ ] **Step 1: Write the failing tests**

Append to `tests/context-builder.test.ts` (follow its import style; `buildContext` is already imported):

```ts
describe("buildContext - server line", () => {
  it("prints the server line right after the header when given", () => {
    const out = buildContext({
      project: null,
      memory: { db: "claude_memory", decisionCount: 0, insightCount: 0 },
      serverLine: "  Server: http://localhost:2480 (ok, 3 ms)",
    });
    expect(out.split("\n")[1]).toBe("  Server: http://localhost:2480 (ok, 3 ms)");
  });
});
```

Append to `tests/session-start.test.ts` a new describe. It needs a child env with the real `ARCADEDB_*` variables removed; add this helper next to `runWithStdin`:

```ts
function stripArcade(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("ARCADEDB_")) out[k] = v;
  return { ...out, ...env };
}
function runCold(stdin: string, env: Record<string, string>): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxBin, "src/session-start.ts"], { env: stripArcade(env), cwd: process.cwd() });
    let stdout = "";
    child.stdout.on("data", d => { stdout += d.toString(); });
    child.on("close", code => resolve({ stdout, code: code ?? 0 }));
    child.on("error", reject);
    child.stdin.write(stdin); child.stdin.end();
  });
}
```

Then:

```ts
describe("session-start hook - bootstrap", () => {
  it("cold HOME: creates .env with defaults and reports no_password when a server is reachable", async () => {
    // Uses the real server URI from ~/.config/arcadedb/.env but a temp HOME with no .env at all.
    rmSync(join(tmpHome, ".config", "arcadedb", ".env"), { force: true });
    const realEnv = readFileSync(join(originalHome!, ".config", "arcadedb", ".env"), "utf8");
    const uri = /ARCADEDB_HTTP_URI=(.*)/.exec(realEnv)?.[1]?.trim() ?? "http://localhost:2480";
    const { stdout, code } = await runCold(
      JSON.stringify({ session_id: "cold-1", cwd: "/nonexistent/dir", hook_event_name: "SessionStart" }),
      { HOME: tmpHome, ARCADEDB_HTTP_URI: uri },
    );
    expect(code).toBe(0);
    const envPath = join(tmpHome, ".config", "arcadedb", ".env");
    expect(existsSync(envPath)).toBe(true);
    expect(readFileSync(envPath, "utf8")).toContain("ARCADEDB_ROOT_PASSWORD=");
    expect(stdout).toContain("but no password configured");
    expect(stdout).toContain("Capture and code graph are off until then.");
    expect(stdout).not.toContain("Memory DB:");
    expect(existsSync(join(tmpHome, ".config", "arcadedb", "sessions", "cold-1.json"))).toBe(false);
  });

  it("unreachable server: exact banner, exit 0, no state", async () => {
    writeFileSync(join(tmpHome, ".config", "arcadedb", ".env"), "ARCADEDB_HTTP_URI=http://127.0.0.1:1\nARCADEDB_ROOT_PASSWORD=x\n");
    const { stdout, code } = await runCold(
      JSON.stringify({ session_id: "down-1", cwd: "/nonexistent/dir" }),
      { HOME: tmpHome },
    );
    expect(code).toBe(0);
    expect(stdout.split("\n")[0]).toBe("ArcadeDB: server not reachable at http://127.0.0.1:1. Start ArcadeDB or run: /arcadedb-config set server http://host:port");
    expect(existsSync(join(tmpHome, ".config", "arcadedb", "sessions", "down-1.json"))).toBe(false);
    const log = readFileSync(join(tmpHome, ".config", "arcadedb", "capture.log"), "utf8");
    expect(log).toContain('"event":"server_unavailable"');
  });

  it("healthy server: prints Server line and creates the memory DB schemas when the memory DB is new", async () => {
    const freshMem = `ss_boot_${Date.now()}`;
    writeConfig({}, freshMem);
    const { stdout } = await runWithStdin("src/session-start.ts", JSON.stringify({ session_id: "boot-1", cwd: "/random/dir" }), { HOME: tmpHome });
    expect(stdout.split("\n")[1]).toMatch(/^  Server: http.*\(ok, \d+ ms\)$/);
    expect(stdout).toContain(`Memory DB: ${freshMem} (0 decisions, 0 insights)`);
    const dbs = await client.listDatabases();
    expect(dbs).toContain(freshMem);
    const types = await client.query<{ name: string }>(freshMem, "sql", "SELECT name FROM schema:types");
    expect(types.map(t => t.name)).toContain("Decision");
    await fetch(`${env.httpUri}/api/v1/server`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(`${env.username}:${env.password}`).toString("base64") }, body: JSON.stringify({ command: `drop database ${freshMem}` }) });
  });
});
```

`writeConfig` in that file writes `projects.json` with `defaultMemoryDb`; the memory DB name used by `resolveConfig` must fall back to `projects.json`'s `defaultMemoryDb` when `ARCADEDB_MEMORY_DB` is not set (see Step 3), so this test drives the memory DB via `writeConfig`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/context-builder.test.ts tests/session-start.test.ts -t "bootstrap|server line"`
Expected: FAIL (no server line; cold case prints nothing because `loadEnv()` throws).

- [ ] **Step 3: Implement**

`src/context-builder.ts`: add `serverLine?: string` to `ContextInput`; in `buildContext`, after pushing the header line, `if (input.serverLine) lines.push(input.serverLine);`.

`src/session-start.ts`: replace the imports of `loadEnv` and the first lines of `main()`:

```ts
import { ensureEnvFile, resolveConfig, toClientEnv } from "./config.js";
import { probeServer, probeBanner } from "./server-probe.js";
```

```ts
async function main(): Promise<void> {
  const input = readHookInput();
  const cwd = input.cwd ?? process.env["PWD"] ?? process.cwd();

  ensureEnvFile();
  const map = loadProjects(projectsJsonPath(), logError);
  const cfg = resolveConfig();
  // projects.json's defaultMemoryDb stays authoritative unless ARCADEDB_MEMORY_DB is set explicitly.
  const memoryDb = cfg.sources.memoryDb === "default" ? map.defaultMemoryDb : cfg.memoryDb;

  const probe = await probeServer(toClientEnv(cfg));
  if (probe.status !== "ok") {
    logCapture("server_unavailable", { status: probe.status, httpUri: probe.httpUri, detail: probe.detail });
    process.stdout.write(probeBanner(probe, cfg.username).join("\n") + "\n");
    return;
  }
  const serverLine = probeBanner(probe, cfg.username)[0]!;

  const client = new Client(toClientEnv(cfg));
  try {
    await applySchemas(client, memoryDb, ["core", "memory"]);
  } catch (err) {
    logError(err);
    logCapture("memory_schema_failed", { db: memoryDb, error: (err as Error)?.message ?? String(err) });
  }

  const remote = safeGitRemote(cwd);
  const match = findProject(map, cwd, remote);
  // ... existing auto-register block unchanged, but every `map.defaultMemoryDb` below becomes `memoryDb`
```

Replace remaining uses of `map.defaultMemoryDb` in `main()` with `memoryDb` (the collision check, `probeMemory`, `tryStartSession`). Pass `serverLine` into `buildContext({ project: projectCtx, memory: memoryCtx, extractorMode: ..., serverLine })`.

Delete the `loadEnv` import. Keep everything else.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/context-builder.test.ts tests/session-start.test.ts tests/capture-e2e.test.ts`
Expected: PASS. The e2e test still passes because its temp HOME copies the real `.env` (probe ok).

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skills/src/session-start.ts packages/claude-skills/src/context-builder.ts packages/claude-skills/tests/session-start.test.ts packages/claude-skills/tests/context-builder.test.ts
git commit -m "feat(claude-skills): SessionStart bootstraps .env, probes the server, ensures memory schemas"
```

---

### Task 4: Index-need decision and registry patch helper

**Files:**
- Create: `src/index-need.ts`
- Modify: `src/auto-register.ts` (append `updateProject`)
- Test: `tests/index-need.test.ts`, `tests/auto-register.test.ts` (append)

**Interfaces:**
- Produces:
  ```ts
  // src/index-need.ts
  export interface IndexNeed { needed: boolean; reason: "never_indexed" | "stale" | "fresh" | "auto_index_off"; staleEdits: number }
  export function staleEditsSince(stalePath: string, key: string, since: string | null): number; // count of lines "[<iso>] <key> (" with iso > since
  export function decideIndexNeed(entry: { lastIndexed: string | null }, key: string, stalePath: string, autoIndex: boolean): IndexNeed;
  export function stalePath(): string; // join(configDir(), "stale.log")
  // src/auto-register.ts
  export function updateProject(projectsPath: string, key: string, patch: Partial<ProjectEntry>): ProjectEntry | null; // atomic tmp+rename, null if key missing
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/index-need.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { staleEditsSince, decideIndexNeed } from "../src/index-need.js";

function stale(lines: string[]): string {
  const p = join(mkdtempSync(join(tmpdir(), "stale-")), "stale.log");
  writeFileSync(p, lines.join("\n") + (lines.length ? "\n" : ""));
  return p;
}

describe("staleEditsSince", () => {
  it("counts only this key's lines newer than since", () => {
    const p = stale([
      "[2026-08-01T10:00:00.000Z] proj-a (cwd=/x)",
      "[2026-08-02T10:00:00.000Z] proj-a (cwd=/x)",
      "[2026-08-03T10:00:00.000Z] proj-b (cwd=/y)",
    ]);
    expect(staleEditsSince(p, "proj-a", "2026-08-01T12:00:00.000Z")).toBe(1);
    expect(staleEditsSince(p, "proj-a", null)).toBe(2);
    expect(staleEditsSince(p, "proj-b", "2026-08-04T00:00:00.000Z")).toBe(0);
  });
  it("returns 0 for a missing file", () => {
    expect(staleEditsSince("/nope/stale.log", "x", null)).toBe(0);
  });
});

describe("decideIndexNeed", () => {
  it("never_indexed when lastIndexed is null", () => {
    const p = stale([]);
    expect(decideIndexNeed({ lastIndexed: null }, "k", p, true)).toEqual({ needed: true, reason: "never_indexed", staleEdits: 0 });
  });
  it("stale when edits after lastIndexed", () => {
    const p = stale(["[2026-08-05T00:00:00.000Z] k (cwd=/x)"]);
    expect(decideIndexNeed({ lastIndexed: "2026-08-04T00:00:00.000Z" }, "k", p, true)).toEqual({ needed: true, reason: "stale", staleEdits: 1 });
  });
  it("fresh when no newer edits", () => {
    const p = stale(["[2026-08-03T00:00:00.000Z] k (cwd=/x)"]);
    expect(decideIndexNeed({ lastIndexed: "2026-08-04T00:00:00.000Z" }, "k", p, true).needed).toBe(false);
  });
  it("auto_index_off wins", () => {
    const p = stale([]);
    expect(decideIndexNeed({ lastIndexed: null }, "k", p, false)).toEqual({ needed: false, reason: "auto_index_off", staleEdits: 0 });
  });
});
```

Append to `tests/auto-register.test.ts` (it already has temp-dir helpers and imports `registerProject`; add `updateProject` to the import):

```ts
describe("updateProject", () => {
  it("patches one entry atomically and returns it; null when missing", () => {
    const p = join(tmp, "projects.json");
    registerProject(p, "a", { db: "a", path: "/a", stack: [], indexLevel: 0, lastIndexed: null });
    const out = updateProject(p, "a", { lastIndexed: "2026-08-27T00:00:00.000Z", indexLevel: 2 });
    expect(out?.lastIndexed).toBe("2026-08-27T00:00:00.000Z");
    expect(JSON.parse(readFileSync(p, "utf8")).projects.a.indexLevel).toBe(2);
    expect(updateProject(p, "zzz", { indexLevel: 1 })).toBeNull();
    expect(existsSync(p + ".tmp")).toBe(false);
  });
});
```

(`tmp` is whatever that file names its per-test temp dir; use the existing variable.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/index-need.test.ts tests/auto-register.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/index-need.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./env-paths.js";

export interface IndexNeed {
  needed: boolean;
  reason: "never_indexed" | "stale" | "fresh" | "auto_index_off";
  staleEdits: number;
}

export function stalePath(): string {
  return join(configDir(), "stale.log");
}

export function staleEditsSince(path: string, key: string, since: string | null): number {
  if (!existsSync(path)) return 0;
  const sinceMs = since ? new Date(since).getTime() : -Infinity;
  let n = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\[([^\]]+)\] (\S+) \(/.exec(line);
    if (!m || m[2] !== key) continue;
    if (new Date(m[1]!).getTime() > sinceMs) n++;
  }
  return n;
}

export function decideIndexNeed(
  entry: { lastIndexed: string | null },
  key: string,
  path: string,
  autoIndex: boolean,
): IndexNeed {
  if (!autoIndex) return { needed: false, reason: "auto_index_off", staleEdits: 0 };
  const staleEdits = staleEditsSince(path, key, entry.lastIndexed);
  if (entry.lastIndexed === null) return { needed: true, reason: "never_indexed", staleEdits };
  if (staleEdits > 0) return { needed: true, reason: "stale", staleEdits };
  return { needed: false, reason: "fresh", staleEdits: 0 };
}
```

Append to `src/auto-register.ts` (reuse its existing atomic write; if the write is inline in `registerProject`, extract `writeProjectsFile(path, map)` and use it in both):

```ts
export function updateProject(projectsPath: string, key: string, patch: Partial<ProjectEntry>): ProjectEntry | null {
  const map = loadProjects(projectsPath);
  const current = map.projects[key];
  if (!current) return null;
  const next = { ...current, ...patch };
  map.projects[key] = next;
  writeProjectsFile(projectsPath, map);
  return next;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/index-need.test.ts tests/auto-register.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skills/src/index-need.ts packages/claude-skills/src/auto-register.ts packages/claude-skills/tests/index-need.test.ts packages/claude-skills/tests/auto-register.test.ts
git commit -m "feat(claude-skills): index-need decision from stale.log; atomic updateProject"
```

---

### Task 5: Background index runner bundle and spawn from SessionStart

**Files:**
- Create: `src/index-runner.ts` (bundle entry), `src/index-spawn.ts`
- Modify: `package.json` (devDependency + bundle script), `src/session-start.ts` (spawn after registration), `src/context-builder.ts` (indexing wording)
- Test: `tests/index-runner.test.ts` (live DB), `tests/session-start.test.ts` (append), `tests/hooks-wiring.test.ts` (append)

**Interfaces:**
- Consumes: `indexRepo` from `arcadedb-code-indexer`; `resolveConfig`, `toClientEnv`; `updateProject`; `logCapture`; `decideIndexNeed`, `stalePath`.
- Produces:
  - `hooks/index.js`: `node hooks/index.js --root <abs> --db <db> --key <key> [--stack <csv>]`. Exit 0 on success/skip, 1 on failure. Lock file `~/.config/arcadedb/index-<key>.lock` containing the pid; removed on exit. Log file `~/.config/arcadedb/index-<key>.log` (runner stdout/stderr, appended by the spawner).
  - `src/index-spawn.ts`: `spawnIndexer(args: { root: string; db: string; key: string; stack: string[] }): number | null` (child pid or null when spawn failed); resolves the runner path as `join(dirname(fileURLToPath(import.meta.url)), "index.js")`, with `CLAUDE_PLUGIN_ROOT` override to `<root>/hooks/index.js` when set.
  - `ProjectContext.indexing?: boolean` renders the Project line as `  Project: <name> (DB: <db>, indexing in background, <files> files so far)`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/index-runner.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { spawn, execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Client, applySchemas } from "arcadedb-agent-memory";
import { createTempDb, env, type TempDb } from "./helpers/temp-db.js";

const require = createRequire(import.meta.url);
const tsxBin = require.resolve("tsx/cli");
const client = new Client(env);

function run(args: string[], home: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [tsxBin, "src/index-runner.ts", ...args], { env: { ...process.env, HOME: home }, cwd: process.cwd() });
    let stdout = "", stderr = "";
    child.stdout.on("data", d => { stdout += d; }); child.stderr.on("data", d => { stderr += d; });
    child.on("close", code => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

let db: TempDb; let home: string; let repo: string; let originalHome: string | undefined;
beforeAll(async () => { db = await createTempDb("idx"); await applySchemas(client, db.name, ["core", "code"]); });
afterAll(async () => { await db.drop(); });
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "idx-home-"));
  originalHome = process.env["HOME"];
  mkdirSync(join(home, ".config", "arcadedb"), { recursive: true });
  copyFileSync(join(originalHome!, ".config", "arcadedb", ".env"), join(home, ".config", "arcadedb", ".env"));
  writeFileSync(join(home, ".config", "arcadedb", "projects.json"), JSON.stringify({ version: 1, defaultMemoryDb: "claude_memory", projects: { proj: { db: db.name, path: "/tmp/x", stack: ["typescript"], indexLevel: 0, lastIndexed: null } } }));
  writeFileSync(join(home, ".config", "arcadedb", "stale.log"), "[2026-08-01T00:00:00.000Z] proj (cwd=/x)\n[2026-08-01T00:00:00.000Z] other (cwd=/y)\n");
  repo = mkdtempSync(join(tmpdir(), "idx-repo-"));
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "a.ts"), 'import { b } from "./b.js";\nexport const a = b;\n');
  writeFileSync(join(repo, "src", "b.ts"), "export const b = 1;\n");
  writeFileSync(join(repo, "package.json"), '{"name":"idx-repo","type":"module"}');
  execSync("git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm init", { cwd: repo });
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }); });

describe("index runner", () => {
  it("indexes the repo, marks lastIndexed, prunes stale.log for the key, logs index_done", async () => {
    const r = await run(["--root", repo, "--db", db.name, "--key", "proj", "--stack", "typescript"], home);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const rows = await client.query<{ n: number }>(db.name, "cypher", "MATCH (f:File) RETURN count(f) AS n");
    expect(rows[0]!.n).toBeGreaterThanOrEqual(2);
    const projects = JSON.parse(readFileSync(join(home, ".config", "arcadedb", "projects.json"), "utf8"));
    expect(projects.projects.proj.lastIndexed).toMatch(/^\d{4}-/);
    expect(readFileSync(join(home, ".config", "arcadedb", "stale.log"), "utf8")).toBe("[2026-08-01T00:00:00.000Z] other (cwd=/y)\n");
    const log = readFileSync(join(home, ".config", "arcadedb", "capture.log"), "utf8");
    expect(log).toContain('"event":"index_started"');
    expect(log).toContain('"event":"index_done"');
    expect(existsSync(join(home, ".config", "arcadedb", "index-proj.lock"))).toBe(false);
  });
  it("skips when a live lock exists", async () => {
    writeFileSync(join(home, ".config", "arcadedb", "index-proj.lock"), String(process.pid));
    const r = await run(["--root", repo, "--db", db.name, "--key", "proj"], home);
    expect(r.code).toBe(0);
    expect(readFileSync(join(home, ".config", "arcadedb", "capture.log"), "utf8")).toContain('"event":"index_skipped_running"');
  });
  it("ignores a stale lock from a dead pid", async () => {
    writeFileSync(join(home, ".config", "arcadedb", "index-proj.lock"), "999999");
    const r = await run(["--root", repo, "--db", db.name, "--key", "proj"], home);
    expect(r.code).toBe(0);
    expect(readFileSync(join(home, ".config", "arcadedb", "capture.log"), "utf8")).toContain('"event":"index_done"');
  });
  it("exits 1 and logs index_failed when the server is unreachable", async () => {
    writeFileSync(join(home, ".config", "arcadedb", ".env"), "ARCADEDB_HTTP_URI=http://127.0.0.1:1\nARCADEDB_ROOT_PASSWORD=x\n");
    const r = await run(["--root", repo, "--db", db.name, "--key", "proj"], home);
    expect(r.code).toBe(1);
    expect(readFileSync(join(home, ".config", "arcadedb", "capture.log"), "utf8")).toContain('"event":"index_failed"');
  });
});
```

Append to `tests/session-start.test.ts` inside the auto-registration describe (it already has a temp git repo + `runWithStdin`; reuse):

```ts
  it("spawns the background indexer on first registration and reports indexing in the banner", async () => {
    const { stdout } = await runWithStdin("src/session-start.ts", JSON.stringify({ session_id: "spawn-1", cwd: repoDir }), { HOME: tmpHome });
    expect(stdout).toMatch(/Project: auto-proj \(DB: auto_proj, indexing in background/);
    const deadline = Date.now() + 30000;
    let done = false;
    while (Date.now() < deadline && !done) {
      const log = existsSync(join(tmpHome, ".config", "arcadedb", "capture.log")) ? readFileSync(join(tmpHome, ".config", "arcadedb", "capture.log"), "utf8") : "";
      done = log.includes('"event":"index_done"');
      if (!done) await new Promise(r => setTimeout(r, 500));
    }
    expect(done).toBe(true);
    const projects = JSON.parse(readFileSync(join(tmpHome, ".config", "arcadedb", "projects.json"), "utf8"));
    expect(projects.projects["auto-proj"].lastIndexed).toMatch(/^\d{4}-/);
  });
  it("does not spawn when ARCADEDB_AUTO_INDEX=off", async () => {
    const { stdout } = await runWithStdin("src/session-start.ts", JSON.stringify({ session_id: "spawn-2", cwd: repoDir }), { HOME: tmpHome, ARCADEDB_AUTO_INDEX: "off" });
    expect(stdout).not.toContain("indexing in background");
  });
```

(`repoDir` is the temp git repo variable that describe already creates; use its real name.)

Append to `tests/hooks-wiring.test.ts`:

```ts
  it("ships a bundled indexer at hooks/index.js", () => {
    expect(existsSync(join(__dirname, "..", "hooks", "index.js"))).toBe(true);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/index-runner.test.ts tests/hooks-wiring.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`package.json`: add `"arcadedb-code-indexer": "*"` under `devDependencies` (workspace link; bundled at build time, not a runtime dep), run `npm install` at repo root. Extend `bundle:hooks`:

```json
"bundle:hooks": "esbuild src/session-start.ts src/post-tool-use.ts src/session-end.ts src/stop.ts --bundle --platform=node --target=node20 --format=esm --outdir=hooks && esbuild bin/arcadedb-skills.ts --bundle --platform=node --target=node20 --format=esm --outfile=hooks/cli.js && esbuild src/index-runner.ts --bundle --platform=node --target=node20 --format=esm --outfile=hooks/index.js && chmod +x hooks/session-start.js hooks/post-tool-use.js hooks/session-end.js hooks/stop.js hooks/cli.js hooks/index.js"
```

```ts
// src/index-runner.ts
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { Client } from "arcadedb-agent-memory";
import { indexRepo } from "arcadedb-code-indexer";
import { configDir, projectsJsonPath } from "./env-paths.js";
import { resolveConfig, toClientEnv } from "./config.js";
import { updateProject } from "./auto-register.js";
import { stalePath } from "./index-need.js";
import { logCapture } from "./capture-log.js";

const MAX_FILES = 20000;

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function acquireLock(path: string): boolean {
  if (existsSync(path)) {
    const pid = Number(readFileSync(path, "utf8").trim());
    if (Number.isFinite(pid) && pid > 0 && pidAlive(pid)) return false;
  }
  writeFileSync(path, String(process.pid));
  return true;
}

function countTrackedFiles(root: string): number {
  try {
    const out = execSync("git ls-files", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
    return out.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

function pruneStale(path: string, key: string): void {
  if (!existsSync(path)) return;
  const kept = readFileSync(path, "utf8").split("\n").filter(l => l && !new RegExp(`^\\[[^\\]]+\\] ${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(`).test(l));
  writeFileSync(path, kept.length ? kept.join("\n") + "\n" : "");
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const root = flag(argv, "root");
  const db = flag(argv, "db");
  const key = flag(argv, "key");
  const stack = flag(argv, "stack");
  if (!root || !db || !key) {
    console.error("usage: index.js --root <abs> --db <db> --key <key> [--stack <csv>]");
    return 1;
  }
  const lock = join(configDir(), `index-${key}.lock`);
  if (!acquireLock(lock)) {
    logCapture("index_skipped_running", { key });
    return 0;
  }
  const started = Date.now();
  try {
    const files = countTrackedFiles(root);
    if (files > MAX_FILES) {
      logCapture("index_skipped_too_large", { key, files });
      return 0;
    }
    logCapture("index_started", { key, db, pid: process.pid, root });
    const client = new Client(toClientEnv(resolveConfig()));
    const summary = await indexRepo(client, root, { db, autoMigrate: true, stack: stack ?? undefined });
    updateProject(projectsJsonPath(), key, { lastIndexed: new Date().toISOString(), indexLevel: 2 });
    pruneStale(stalePath(), key);
    logCapture("index_done", { key, files: summary.files, imports: summary.imports, unresolved: summary.unresolved, ms: Date.now() - started });
    console.log(`indexed ${key}: ${summary.files} files, ${summary.imports} imports, ${summary.unresolved} unresolved`);
    return 0;
  } catch (err) {
    logCapture("index_failed", { key, error: (err as Error)?.message ?? String(err) });
    console.error(`index failed: ${(err as Error)?.message ?? String(err)}`);
    return 1;
  } finally {
    try { unlinkSync(lock); } catch { /* already gone */ }
  }
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(1); });
```

```ts
// src/index-spawn.ts
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configDir } from "./env-paths.js";

export function runnerPath(): string {
  const root = process.env["CLAUDE_PLUGIN_ROOT"];
  return root ? join(root, "hooks", "index.js") : join(dirname(fileURLToPath(import.meta.url)), "index.js");
}

export function spawnIndexer(args: { root: string; db: string; key: string; stack: string[]; runner?: string }): number | null {
  try {
    const log = openSync(join(configDir(), `index-${args.key}.log`), "a");
    const argv = [args.runner ?? runnerPath(), "--root", args.root, "--db", args.db, "--key", args.key];
    if (args.stack.length) argv.push("--stack", args.stack.join(","));
    const child = spawn(process.execPath, argv, { detached: true, stdio: ["ignore", log, log], env: process.env });
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  }
}
```

When running from `src/` under tsx (tests), `runnerPath()` resolves to `src/index.js`, which does not exist. In `session-start.ts` pass `runner` explicitly when `import.meta.url` ends with `.ts`: `runner: import.meta.url.endsWith(".ts") ? undefined : undefined` is pointless; instead do this in `index-spawn.ts`:

```ts
export function runnerPath(): string {
  const root = process.env["CLAUDE_PLUGIN_ROOT"];
  if (root) return join(root, "hooks", "index.js");
  const here = fileURLToPath(import.meta.url);
  // Bundled: hooks/session-start.js -> hooks/index.js. Source (tests via tsx): src/index-spawn.ts -> run src/index-runner.ts through tsx.
  return here.endsWith(".ts") ? join(dirname(here), "index-runner.ts") : join(dirname(here), "index.js");
}
```

and in `spawnIndexer`, when the runner ends with `.ts`, prefix argv with the tsx CLI: `const tsx = createRequire(import.meta.url).resolve("tsx/cli"); argv = [tsx, runner, ...]`. Bundled builds never hit that branch.

`src/session-start.ts`: after the project is known (registered or matched) and before `probeProject`:

```ts
import { decideIndexNeed, stalePath } from "./index-need.js";
import { spawnIndexer } from "./index-spawn.js";
...
  let indexing = false;
  if (project && project.entry.path) {
    const need = decideIndexNeed(project.entry, project.key, stalePath(), cfg.autoIndex);
    if (need.needed) {
      const pid = spawnIndexer({ root: project.entry.path, db: project.entry.db, key: project.key, stack: project.entry.stack });
      indexing = pid !== null;
      logCapture("index_spawned", { key: project.key, reason: need.reason, staleEdits: need.staleEdits, pid });
    }
  }
  ...
  if (projectCtx && indexing) projectCtx.indexing = true;
```

`src/context-builder.ts`: add `indexing?: boolean` to `ProjectContext`; in `buildContext`, before the auto-registered branch:

```ts
    if (p.indexing) {
      lines.push(`  Project: ${p.name} (DB: ${p.db}, indexing in background, ${p.fileCount} files so far)`);
    } else if (p.autoRegistered && p.lastIndexed === null) { ...existing... } else { ...existing... }
```

Build: `npm run build`. Confirm `hooks/index.js` exists and `cd /tmp && node <abs>/hooks/index.js` prints the usage line and exits 1.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/index-runner.test.ts tests/session-start.test.ts tests/hooks-wiring.test.ts tests/context-builder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (bundles included)**

```bash
git add packages/claude-skills/package.json package-lock.json packages/claude-skills/src packages/claude-skills/hooks packages/claude-skills/tests
git commit -m "feat(claude-skills): background indexer bundle spawned from SessionStart"
```

---

### Task 6: `config` CLI subcommands

**Files:**
- Create: `src/config-cli.ts`
- Modify: `bin/arcadedb-skills.ts` (dispatch `config`)
- Test: `tests/cli-config.test.ts`

**Interfaces:**
- Produces in `src/config-cli.ts`:
  ```ts
  export async function configShow(io: { out: (s: string) => void }): Promise<number>;
  export function configSet(key: string, value: string, io: { out: (s: string) => void; err: (s: string) => void }): number;
  export async function configTest(io: { out: (s: string) => void }): Promise<number>;
  export async function configForget(key: string, dropDb: boolean, io: { out: (s: string) => void; err: (s: string) => void }): Promise<number>;
  export async function configIndex(keyOrNull: string | null, cwd: string, io: { out: (s: string) => void; err: (s: string) => void }): Promise<number>;
  ```
  CLI: `config show | set <server|user|password|memory-db|auto-index> <value> | test | forget <key> [--drop-db] | index [<key>]`.
- `set` mapping: `server`→`ARCADEDB_HTTP_URI` (must match `/^https?:\/\/[^\s/]+$/`), `user`→`ARCADEDB_USERNAME`, `password`→`ARCADEDB_ROOT_PASSWORD`, `memory-db`→`ARCADEDB_MEMORY_DB` (must match `/^[a-z][a-z0-9_]*$/`), `auto-index`→`ARCADEDB_AUTO_INDEX` (`on|off`). Invalid → exit 1 with `invalid value for <key>: <hint>`. After a successful `set` of server/user/password, run the probe and print its banner line(s).
- `show` prints:
  ```
  ArcadeDB config (~/.config/arcadedb/.env)
    server:     http://localhost:2480   (file)
    user:       root                    (default)
    password:   ********                (file)
    memory-db:  claude_memory           (default)
    auto-index: on                      (default)
  Server: <probe banner first line>
  Projects (<n>):
    <key> -> <db> (indexed: <lastIndexed|never>, stale edits: <n>, <path>)
  ```
- `index` runs the runner in the foreground: `spawnSync(process.execPath, [runnerPath(), ...])` with inherited stdio, returns its exit code; key resolves from argument or `findProject` on cwd; unregistered → exit 1 `not registered: start a Claude Code session in the repo root once`.
- `forget`: `updateProject` cannot delete; add `removeProject(projectsPath, key): boolean` to `src/auto-register.ts` (atomic). With `--drop-db`, `client.command("drop database <db>")`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/cli-config.test.ts
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
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/cli-config.test.ts`
Expected: FAIL (`unknown command: config`).

- [ ] **Step 3: Implement**

`src/auto-register.ts` append:

```ts
export function removeProject(projectsPath: string, key: string): boolean {
  const map = loadProjects(projectsPath);
  if (!map.projects[key]) return false;
  delete map.projects[key];
  writeProjectsFile(projectsPath, map);
  return true;
}
```

```ts
// src/config-cli.ts
import { spawnSync } from "node:child_process";
import { Client } from "arcadedb-agent-memory";
import { resolveConfig, toClientEnv, writeEnvFile, type ResolvedConfig } from "./config.js";
import { probeServer, probeBanner } from "./server-probe.js";
import { loadProjects, findProject } from "./project-map.js";
import { projectsJsonPath } from "./env-paths.js";
import { removeProject } from "./auto-register.js";
import { staleEditsSince, stalePath } from "./index-need.js";
import { runnerPath } from "./index-spawn.js";

type Io = { out: (s: string) => void; err?: (s: string) => void };

const SET_KEYS: Record<string, { env: string; validate: (v: string) => string | null }> = {
  server: { env: "ARCADEDB_HTTP_URI", validate: v => /^https?:\/\/[^\s/]+$/.test(v) ? null : "expected http://host:port" },
  user: { env: "ARCADEDB_USERNAME", validate: v => v.trim() ? null : "expected a user name" },
  password: { env: "ARCADEDB_ROOT_PASSWORD", validate: v => v ? null : "expected a non-empty password" },
  "memory-db": { env: "ARCADEDB_MEMORY_DB", validate: v => /^[a-z][a-z0-9_]*$/.test(v) ? null : "expected [a-z][a-z0-9_]*" },
  "auto-index": { env: "ARCADEDB_AUTO_INDEX", validate: v => v === "on" || v === "off" ? null : "expected on or off" },
};

function pad(s: string, n: number): string { return s.padEnd(n); }

export async function configShow(io: Io): Promise<number> {
  const cfg = resolveConfig();
  const map = loadProjects(projectsJsonPath());
  const memoryDb = cfg.sources.memoryDb === "default" ? map.defaultMemoryDb : cfg.memoryDb;
  io.out(`ArcadeDB config (${cfg.envPath})`);
  io.out(`  ${pad("server:", 12)}${pad(cfg.httpUri, 24)}(${cfg.sources.httpUri})`);
  io.out(`  ${pad("user:", 12)}${pad(cfg.username, 24)}(${cfg.sources.username})`);
  io.out(`  ${pad("password:", 12)}${pad(cfg.password ? "********" : "(not set)", 24)}(${cfg.sources.password})`);
  io.out(`  ${pad("memory-db:", 12)}${pad(memoryDb, 24)}(${cfg.sources.memoryDb})`);
  io.out(`  ${pad("auto-index:", 12)}${pad(cfg.autoIndex ? "on" : "off", 24)}(${cfg.sources.autoIndex})`);
  const probe = await probeServer(toClientEnv(cfg));
  io.out(probeBanner(probe, cfg.username)[0]!.replace(/^ {2}/, ""));
  const keys = Object.keys(map.projects);
  io.out(`Projects (${keys.length}):`);
  for (const key of keys) {
    const e = map.projects[key]!;
    io.out(`  ${key} -> ${e.db} (indexed: ${e.lastIndexed ?? "never"}, stale edits: ${staleEditsSince(stalePath(), key, e.lastIndexed)}, ${e.path})`);
  }
  return 0;
}

export function configSet(key: string, value: string, io: Io): number {
  const spec = SET_KEYS[key];
  if (!spec) { io.err?.(`unknown key: ${key} (server|user|password|memory-db|auto-index)`); return 1; }
  const problem = spec.validate(value);
  if (problem) { io.err?.(`invalid value for ${key}: ${problem}`); return 1; }
  writeEnvFile({ [spec.env]: value });
  io.out(`${key} updated in ${resolveConfig().envPath}`);
  return 0;
}

export async function configTest(io: Io): Promise<number> {
  const cfg = resolveConfig();
  const probe = await probeServer(toClientEnv(cfg));
  for (const line of probeBanner(probe, cfg.username)) io.out(line.replace(/^ {2}/, ""));
  return probe.status === "ok" ? 0 : 1;
}

export async function configForget(key: string, dropDb: boolean, io: Io): Promise<number> {
  const map = loadProjects(projectsJsonPath());
  const entry = map.projects[key];
  if (!entry) { io.err?.(`not registered: ${key}`); return 1; }
  if (dropDb) {
    const client = new Client(toClientEnv(resolveConfig()));
    await client.command(`drop database ${entry.db}`);
    io.out(`dropped database ${entry.db}`);
  }
  removeProject(projectsJsonPath(), key);
  io.out(`forgot ${key}`);
  return 0;
}

export async function configIndex(keyArg: string | null, cwd: string, io: Io): Promise<number> {
  const map = loadProjects(projectsJsonPath());
  const match = keyArg ? (map.projects[keyArg] ? { key: keyArg, entry: map.projects[keyArg]! } : null) : findProject(map, cwd, null);
  if (!match) { io.err?.("not registered: start a Claude Code session in the repo root once, then re-run"); return 1; }
  const argv = [runnerPath(), "--root", match.entry.path, "--db", match.entry.db, "--key", match.key];
  if (match.entry.stack.length) argv.push("--stack", match.entry.stack.join(","));
  const r = spawnSync(process.execPath, argv, { stdio: "inherit", env: process.env });
  return r.status ?? 1;
}
```

`bin/arcadedb-skills.ts`: add

```ts
import { configShow, configSet, configTest, configForget, configIndex } from "../src/config-cli.js";
...
  if (cmd === "config") {
    const [sub, ...args] = rest;
    const io = { out: (s: string) => console.log(s), err: (s: string) => console.error(s) };
    switch (sub) {
      case "show": return configShow(io);
      case "set": {
        const [key, ...valueParts] = args;
        if (!key || valueParts.length === 0) { console.error("usage: arcadedb-skills config set <server|user|password|memory-db|auto-index> <value>"); return 1; }
        const code = configSet(key, valueParts.join(" "), io);
        if (code === 0 && (key === "server" || key === "user" || key === "password")) await configTest(io);
        return code;
      }
      case "test": return configTest(io);
      case "forget": {
        const key = args.find(a => !a.startsWith("--"));
        if (!key) { console.error("usage: arcadedb-skills config forget <key> [--drop-db]"); return 1; }
        return configForget(key, args.includes("--drop-db"), io);
      }
      case "index": return configIndex(args[0] ?? null, process.env["PWD"] ?? process.cwd(), io);
      default:
        console.error("usage: arcadedb-skills config <show|set|test|forget|index>");
        return 1;
    }
  }
```

Also add the `config` line to `usage()`.

Note: `set server` followed by `configTest` returns the probe exit code inside `set`; keep `set`'s exit code 0 when the write succeeded (the probe output is informational). Adjust: `await configTest(io); return 0;`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/cli-config.test.ts tests/cli-extract-write.test.ts tests/cli-extractor-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skills/src/config-cli.ts packages/claude-skills/src/auto-register.ts packages/claude-skills/bin/arcadedb-skills.ts packages/claude-skills/tests/cli-config.test.ts
git commit -m "feat(claude-skills): config show/set/test/forget/index CLI"
```

---

### Task 7: Commands, README, barrel exports, bundles

**Files:**
- Create: `commands/arcadedb-config.md`
- Delete: `commands/arcadedb-init.md`
- Modify: `commands/graph-index.md`, `commands/graph-status.md`, `README.md` (package) and root `README.md` quick start, `src/index.ts`
- Test: `tests/skills-commands.test.ts`, `tests/plugin-manifest.test.ts`, `tests/index-barrel.test.ts` (adjust/append)

- [ ] **Step 1: Update tests**

In `tests/skills-commands.test.ts`: replace any `arcadedb-init` describe with:

```ts
describe("command: arcadedb-config", () => {
  const md = readFile("commands/arcadedb-config.md");
  it("has frontmatter with description and Bash allowed", () => {
    expect(md).toMatch(/^---\n[\s\S]*description:/);
    expect(md).toContain("allowed-tools: Bash");
  });
  it("documents every subcommand via the bundled cli", () => {
    for (const sub of ["config show", "config set", "config test", "config forget", "config index"]) expect(md).toContain(sub);
    expect(md).toContain("${CLAUDE_PLUGIN_ROOT}/hooks/cli.js");
    expect(md).not.toContain("arcadedb-init");
  });
  it("arcadedb-init.md is gone", () => {
    expect(existsSync(join(__dirname, "..", "commands", "arcadedb-init.md"))).toBe(false);
  });
});
```

In the `graph-index` describe add: `expect(md).toContain("config index");` and `expect(md).not.toContain("npm install -g");`. In the `graph-status` describe add: `expect(md).toContain("config show");`.

`tests/plugin-manifest.test.ts`: if it lists expected command files, replace `arcadedb-init.md` with `arcadedb-config.md`.

`tests/index-barrel.test.ts`: assert exports `resolveConfig`, `probeServer`, `decideIndexNeed`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/skills-commands.test.ts tests/plugin-manifest.test.ts tests/index-barrel.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`commands/arcadedb-config.md`:

````markdown
---
description: "Show or change ArcadeDB plugin settings (server, user, password, memory DB, auto-index), test the connection, forget a project, or index now. Everything else is automatic."
argument-hint: "[show | set <key> <value> | test | forget <project> [--drop-db] | index [<project>]]"
allowed-tools: Bash
---

# /arcadedb-config

The only knob. Defaults: server `http://localhost:2480`, user `root`, memory DB `claude_memory`, auto-index on. Settings live in `~/.config/arcadedb/.env`; shell `ARCADEDB_*` variables override the file.

Run the bundled CLI. `$ARGUMENTS` is passed through verbatim; with no arguments run `show`.

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/cli.js" config ${ARGUMENTS:-show}
```

## Subcommands

- `config show`: every setting with its source, server status, registered projects.
- `config set server http://host:port`, `config set user <name>`, `config set password <pw>`, `config set memory-db <name>`, `config set auto-index on|off`. Server/user/password changes print the probe result.
- `config test`: probe the server and print the result.
- `config forget <project> [--drop-db]`: remove a project from the registry. Before passing `--drop-db`, confirm with the user; it deletes the project's graph database.
- `config index [<project>]`: index now, in the foreground (the plugin also does this automatically in the background).

Print the CLI output as-is. If the output says the server is unreachable or unauthorized, tell the user which `config set` command fixes it.
````

`commands/graph-index.md`: body becomes "Alias for `/arcadedb-config index`" with the same bash line (`config index ${ARGUMENTS}`), keep frontmatter; remove the `npm install -g` prerequisites.

`commands/graph-status.md`: step 1 becomes `node "${CLAUDE_PLUGIN_ROOT}/hooks/cli.js" config show`; remove the `arcadedb-memory on PATH` prerequisite; keep the type-count section only if `arcadedb-memory` is available (say "optional").

Delete `commands/arcadedb-init.md` (`git rm`).

`src/index.ts` append:

```ts
export { resolveConfig, ensureEnvFile, writeEnvFile, readEnvFile, DEFAULTS } from "./config.js";
export type { ResolvedConfig } from "./config.js";
export { probeServer, probeBanner } from "./server-probe.js";
export type { ProbeResult, ProbeStatus } from "./server-probe.js";
export { decideIndexNeed, staleEditsSince } from "./index-need.js";
```

README (root, Quick start section) replace the init instructions with:

```markdown
## Quick start

1. Run ArcadeDB (any way you like), e.g.
   `docker run -d --name arcadedb -p 2480:2480 -e JAVA_OPTS="-Darcadedb.server.rootPassword=changeme" arcadedata/arcadedb:latest`
2. Install the plugin in Claude Code from the `arcadedb-claude` marketplace.
3. If your server has a password: `/arcadedb-config set password changeme`. That is the only manual step.

Open Claude Code in any git repo. The project registers itself, its code graph is indexed in the background, and decisions/insights from each session are captured into `claude_memory`. `/arcadedb-config` shows everything and changes ports, users, or the memory DB when they differ from the defaults.
```

Mirror the same three steps in `packages/claude-skills/README.md`.

Rebuild bundles: `npm run build`.

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: all green (live ArcadeDB required).

- [ ] **Step 5: Commit**

```bash
git add -A packages/claude-skills README.md
git commit -m "feat(claude-skills): /arcadedb-config replaces /arcadedb-init; graph-index and graph-status use the bundled cli"
```

---

### Task 8: Release 0.7.0

**Files:**
- Modify: `packages/claude-skills/package.json`, `packages/claude-skills/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (2 pins), `package-lock.json` (via `npm install --package-lock-only`)
- Modify: `docs/CHANGELOG.md`, `docs/STATE.md`, `docs/BACKLOG.md`, `docs/JOURNAL.md`, `docs/FEATURE-MAP.md`, `docs/GLOSSARY.md`

- [ ] **Step 1: Bump**

Change every `0.6.2` pin for `arcadedb-claude-skills` to `0.7.0`; run `npm install --package-lock-only` at the repo root; `cd packages/claude-skills && npm run build && npm test`.

- [ ] **Step 2: Docs**

`docs/CHANGELOG.md`, new section above 0.6.2:

```markdown
## arcadedb-claude-skills 0.7.0 - <today>
### Added
- Zero-config bootstrap on SessionStart: .env created with defaults, server probed, claude_memory schemas ensured.
- Background code indexing (hooks/index.js) on first registration and whenever stale.log shows edits. 20k tracked-file guard, per-project lock.
- /arcadedb-config: show, set (server, user, password, memory-db, auto-index), test, forget, index.
- Exact banner lines for unreachable / no password / unauthorized servers.
### Changed
- /arcadedb-init removed. /graph-index is an alias for /arcadedb-config index. /graph-status uses the bundled cli.
- Settings precedence: shell ARCADEDB_* > ~/.config/arcadedb/.env > defaults.
```

`docs/FEATURE-MAP.md`: rows for `/arcadedb-config` (shipped 0.7.0), background auto-index (shipped 0.7.0), SessionStart bootstrap (shipped 0.7.0); drop the `/arcadedb-init` row.
`docs/STATE.md`: Phase line "1 - plug-and-play shipped (0.7.0); S2 embed next"; add a ground-truth bullet with what is automatic now.
`docs/BACKLOG.md`: add "Index size guard tuning (20k files) after platform / transprt.net numbers" under Deferred.
`docs/GLOSSARY.md`: add `capture.log`, `stale.log`, `/arcadedb-config`; update `projects.json` line.
`docs/JOURNAL.md`: prepend `## <today> - Session: Plug-and-play (0.7.0)` with Topic / Built / Decided (ArcadeDB is a requirement; only manual step is the password; no docker management) / Next.

No em-dashes. Commit:

```bash
git add -A
git commit -m "chore(release): arcadedb-claude-skills 0.7.0 - plug-and-play"
```

- [ ] **Step 3: Ship (user-driven)**

Push main, tag `v0.7.0-plugin`, watch the publish workflow, `npm view arcadedb-claude-skills version` shows 0.7.0. Update the plugin in Claude Code. Real-session proof: in an unregistered repo, one new session should print `Server: ... (ok ...)`, `auto-registered ... indexing in background`; `~/.config/arcadedb/capture.log` gets `project_registered`, `index_spawned`, `index_started`, `index_done`; the next session prints file/import counts. Record it in STATE.md.

---

## Self-review

**Spec coverage:**
- `.env` auto-create, precedence, `.env` writer: Task 1. Probe + exact banners: Task 2. Bootstrap order, memory schemas, failure short-circuit: Task 3. Index need from `stale.log`: Task 4. Background runner with lock, size guard, registry update, stale prune, logs: Task 5. `/arcadedb-config` five subcommands, `/arcadedb-init` removal, `/graph-index` alias, `/graph-status`, README: Tasks 6-7. Release + proof: Task 8.
- Spec "Stop hook checks a cached probe result (`serverOk`)": deliberately simplified. When the probe fails, SessionStart writes no state file, so the Stop hook already logs `skip no_state` and never dispatches. No new state field. The spec's `server_unavailable` event is logged by SessionStart instead.
- Spec "retry failed index at most once per day (`lastIndexAttempt`)": not implemented in this plan. `index_failed` leaves `lastIndexed` null, so the next SessionStart retries. Added to BACKLOG in Task 8 as "index retry backoff".
- Spec "`config show` lists background index running (lock present)" for `/graph-status`: covered by `config show` printing stale edits; lock presence is not printed. Minor, acceptable.

**Placeholder scan:** none. `<today>` in Task 8 is a date to fill from `date +%Y-%m-%d`, stated inline.

**Type consistency:** `resolveConfig()/toClientEnv()` (T1) used in T3, T5, T6; `probeServer/probeBanner` (T2) in T3, T6; `decideIndexNeed/staleEditsSince/stalePath` (T4) in T5, T6; `updateProject/removeProject` (T4/T6) in T5/T6; `runnerPath/spawnIndexer` (T5) in T6. `ProjectContext.indexing` and `ContextInput.serverLine` defined in T3/T5 and consumed only there.
