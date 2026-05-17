import { describe, it, expect } from "vitest";
import { parsePhpImports } from "../../src/parsers/php-imports.js";

describe("parsePhpImports", () => {
  it("extracts a single use statement", () => {
    const src = `<?php\nuse App\\Models\\User;\nclass X {}`;
    expect(parsePhpImports(src)).toEqual(["App\\Models\\User"]);
  });

  it("extracts multiple use statements", () => {
    const src = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\User;
use App\\Services\\AuthService;

class UserController {}`;
    expect(parsePhpImports(src)).toEqual([
      "App\\Models\\User",
      "App\\Services\\AuthService",
    ]);
  });

  it("extracts use with alias (keeps the FQN, drops 'as Alias')", () => {
    const src = `<?php\nuse App\\Models\\User as UserModel;`;
    expect(parsePhpImports(src)).toEqual(["App\\Models\\User"]);
  });

  it("extracts grouped use { A, B }", () => {
    const src = `<?php\nuse App\\Models\\{User, Post};`;
    expect(parsePhpImports(src)).toEqual([
      "App\\Models\\User",
      "App\\Models\\Post",
    ]);
  });

  it("returns empty array when no use statements", () => {
    expect(parsePhpImports(`<?php class X {}`)).toEqual([]);
  });
});
