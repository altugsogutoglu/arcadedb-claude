import { describe, it, expect } from "vitest";
import { parseTsImports } from "../../src/parsers/ts-imports.js";

describe("parseTsImports", () => {
  it("extracts named ESM imports", () => {
    const src = `import { foo, bar } from "./mod";`;
    expect(parseTsImports(src)).toEqual(["./mod"]);
  });

  it("extracts default imports", () => {
    const src = `import React from "react";`;
    expect(parseTsImports(src)).toEqual(["react"]);
  });

  it("extracts namespace imports", () => {
    const src = `import * as fs from "node:fs";`;
    expect(parseTsImports(src)).toEqual(["node:fs"]);
  });

  it("extracts side-effect imports", () => {
    const src = `import "./globals.css";`;
    expect(parseTsImports(src)).toEqual(["./globals.css"]);
  });

  it("extracts dynamic imports", () => {
    const src = `const m = await import("./lazy");`;
    expect(parseTsImports(src)).toEqual(["./lazy"]);
  });

  it("extracts CommonJS requires", () => {
    const src = `const x = require("./util");`;
    expect(parseTsImports(src)).toEqual(["./util"]);
  });

  it("returns multiple imports in source order", () => {
    const src = `import a from "a";\nimport b from "b";\nimport c from "c";`;
    expect(parseTsImports(src)).toEqual(["a", "b", "c"]);
  });

  it("returns empty array when there are no imports", () => {
    expect(parseTsImports(`const x = 1;`)).toEqual([]);
  });

  it("ignores imports inside string literals or comments", () => {
    const src = `// import { x } from "./fake";\nconst s = 'import a from \"b\"';`;
    expect(parseTsImports(src)).toEqual([]);
  });
});
