import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveProjectIdentity,
  detectStack,
  registerProject,
  gitToplevel,
  RegistrationError,
  MEMORY_DB_COLLISION,
} from "../src/auto-register.js";
import type { ProjectEntry } from "../src/project-map.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arcadedb-autoreg-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function entry(db: string): ProjectEntry {
  return { db, path: "/x", stack: [], indexLevel: 0, lastIndexed: null };
}

describe("deriveProjectIdentity", () => {
  it("uses the ssh remote repo name", () => {
    expect(deriveProjectIdentity("/some/where", "git@github.com:altugsogutoglu/borkol-com.git"))
      .toEqual({ key: "borkol-com", db: "borkol_com" });
  });

  it("uses the https remote repo name", () => {
    expect(deriveProjectIdentity("/some/where", "https://github.com/altugsogutoglu/borkol-com.git"))
      .toEqual({ key: "borkol-com", db: "borkol_com" });
  });

  it("falls back to the cwd basename when there is no remote", () => {
    expect(deriveProjectIdentity("/some/where/my-proj", null))
      .toEqual({ key: "my-proj", db: "my_proj" });
  });

  it("prefixes a db name that starts with a digit", () => {
    expect(deriveProjectIdentity("/x/2way2-app", null))
      .toEqual({ key: "2way2-app", db: "p_2way2_app" });
  });

  it("sanitizes dots in the name", () => {
    expect(deriveProjectIdentity("/x/transprt.net", null))
      .toEqual({ key: "transprt.net", db: "transprt_net" });
  });

  it("lowercases and collapses non-alphanumeric runs, trimming edges", () => {
    expect(deriveProjectIdentity("/x/-My Cool--Repo-", null).db).toBe("my_cool_repo");
  });
});

describe("detectStack", () => {
  it("returns an empty list for an empty dir", () => {
    expect(detectStack(dir)).toEqual([]);
  });

  it("detects laravel from composer.json", () => {
    writeFileSync(join(dir, "composer.json"), "{}");
    expect(detectStack(dir)).toEqual(["laravel"]);
  });

  it("detects nextjs and does not add javascript", () => {
    writeFileSync(join(dir, "next.config.mjs"), "export default {};");
    writeFileSync(join(dir, "package.json"), "{}");
    expect(detectStack(dir)).toEqual(["nextjs"]);
  });

  it("detects expo from app.json containing expo", () => {
    writeFileSync(join(dir, "app.json"), JSON.stringify({ expo: { name: "x" } }));
    writeFileSync(join(dir, "package.json"), "{}");
    expect(detectStack(dir)).toEqual(["expo"]);
  });

  it("ignores app.json without an expo key", () => {
    writeFileSync(join(dir, "app.json"), JSON.stringify({ name: "x" }));
    writeFileSync(join(dir, "package.json"), "{}");
    expect(detectStack(dir)).toEqual(["javascript"]);
  });

  it("detects typescript only, not javascript, for a ts package", () => {
    writeFileSync(join(dir, "tsconfig.json"), "{}");
    writeFileSync(join(dir, "package.json"), "{}");
    expect(detectStack(dir)).toEqual(["typescript"]);
  });

  it("detects javascript for a package.json with no other JS-side marker", () => {
    writeFileSync(join(dir, "package.json"), "{}");
    expect(detectStack(dir)).toEqual(["javascript"]);
  });

  it("detects python from pyproject.toml", () => {
    writeFileSync(join(dir, "pyproject.toml"), "");
    expect(detectStack(dir)).toEqual(["python"]);
  });

  it("detects python from requirements.txt without duplicating", () => {
    writeFileSync(join(dir, "pyproject.toml"), "");
    writeFileSync(join(dir, "requirements.txt"), "");
    expect(detectStack(dir)).toEqual(["python"]);
  });

  it("returns markers in a stable order", () => {
    writeFileSync(join(dir, "composer.json"), "{}");
    writeFileSync(join(dir, "next.config.ts"), "export default {};");
    writeFileSync(join(dir, "tsconfig.json"), "{}");
    writeFileSync(join(dir, "requirements.txt"), "");
    expect(detectStack(dir)).toEqual(["laravel", "nextjs", "typescript", "python"]);
  });
});

describe("registerProject", () => {
  it("creates projects.json when it is missing", () => {
    const path = join(dir, "nested", "projects.json");
    expect(registerProject(path, "alpha", entry("alpha_db")).created).toBe(true);
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed.version).toBe(1);
    expect(parsed.defaultMemoryDb).toBe("claude_memory");
    expect(parsed.projects.alpha.db).toBe("alpha_db");
  });

  it("writes 2-space indented JSON", () => {
    const path = join(dir, "projects.json");
    registerProject(path, "alpha", entry("alpha_db"));
    expect(readFileSync(path, "utf8")).toContain('\n  "version": 1');
  });

  it("adds an entry and preserves the existing ones", () => {
    const path = join(dir, "projects.json");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify({
      version: 1,
      defaultMemoryDb: "mem_x",
      projects: { beta: entry("beta_db") },
    }, null, 2));

    registerProject(path, "alpha", entry("alpha_db"));
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(Object.keys(parsed.projects).sort()).toEqual(["alpha", "beta"]);
    expect(parsed.projects.beta.db).toBe("beta_db");
    expect(parsed.defaultMemoryDb).toBe("mem_x");
  });

  it("returns the stored entry with created=false and leaves the file untouched", () => {
    const path = join(dir, "projects.json");
    const original = JSON.stringify({
      version: 1,
      defaultMemoryDb: "claude_memory",
      projects: { alpha: entry("original_db") },
    }, null, 2);
    writeFileSync(path, original);

    const result = registerProject(path, "alpha", entry("new_db"));
    expect(result.created).toBe(false);
    expect(result.entry.db).toBe("original_db");
    expect(readFileSync(path, "utf8")).toBe(original);
  });

  it("refuses a db name that collides with the default memory db", () => {
    const path = join(dir, "projects.json");
    const original = JSON.stringify({
      version: 1,
      defaultMemoryDb: "claude_memory",
      projects: {},
    }, null, 2);
    writeFileSync(path, original);

    expect(() => registerProject(path, "claude-memory", entry("claude_memory")))
      .toThrow(RegistrationError);
    try {
      registerProject(path, "claude-memory", entry("claude_memory"));
    } catch (err) {
      expect((err as RegistrationError).reason).toBe(MEMORY_DB_COLLISION);
    }
    expect(readFileSync(path, "utf8")).toBe(original);
  });

  it("leaves no .tmp file behind", () => {
    const path = join(dir, "projects.json");
    registerProject(path, "alpha", entry("alpha_db"));
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });
});

describe("gitToplevel", () => {
  it("returns the repo root from the repo root", () => {
    execSync("git init -q", { cwd: dir, stdio: "ignore" });
    expect(gitToplevel(dir)).toBe(realpathSync(dir));
  });

  it("returns the repo root from a subdirectory", () => {
    execSync("git init -q", { cwd: dir, stdio: "ignore" });
    const sub = join(dir, "packages", "deep");
    mkdirSync(sub, { recursive: true });
    expect(gitToplevel(sub)).toBe(realpathSync(dir));
  });

  it("is null for a plain dir", () => {
    expect(gitToplevel(dir)).toBe(null);
  });

  it("is null for a nonexistent dir", () => {
    expect(gitToplevel(join(dir, "nope"))).toBe(null);
  });
});
