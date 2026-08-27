import { describe, it, expect } from "vitest";
import { parseJavaPackage, parseJavaImports } from "../../../src/code-indexer/parsers/java-imports.js";

describe("parseJavaPackage", () => {
  it("extracts the package name", () => {
    expect(parseJavaPackage(`package com.example.app;\n\nclass X {}`)).toBe("com.example.app");
  });

  it("returns null for the default package", () => {
    expect(parseJavaPackage(`class X {}`)).toBeNull();
  });

  it("ignores a commented-out package line", () => {
    expect(parseJavaPackage(`// package com.commented;\npackage com.real;`)).toBe("com.real");
  });

  it("ignores a block-commented package line and extracts the real one", () => {
    expect(parseJavaPackage(`/* Copyright 2024 */\npackage com.real;`)).toBe("com.real");
  });
});

describe("parseJavaImports", () => {
  it("extracts a single import as the class FQN", () => {
    expect(parseJavaImports(`import com.foo.Bar;`)).toEqual([
      { fqn: "com.foo.Bar", kind: "single" },
    ]);
  });

  it("extracts a static import as the class FQN (drops the member)", () => {
    expect(parseJavaImports(`import static com.foo.Bar.method;`)).toEqual([
      { fqn: "com.foo.Bar", kind: "static" },
    ]);
  });

  it("extracts a static wildcard import as the class FQN", () => {
    expect(parseJavaImports(`import static com.foo.Bar.*;`)).toEqual([
      { fqn: "com.foo.Bar", kind: "static" },
    ]);
  });

  it("extracts a type wildcard import as the package name", () => {
    expect(parseJavaImports(`import com.foo.*;`)).toEqual([
      { fqn: "com.foo", kind: "wildcard" },
    ]);
  });

  it("extracts multiple imports in order", () => {
    const src = `package com.app;
import com.foo.Bar;
import com.baz.*;
import static java.lang.Math.max;

public class App {}`;
    expect(parseJavaImports(src)).toEqual([
      { fqn: "com.foo.Bar", kind: "single" },
      { fqn: "com.baz", kind: "wildcard" },
      { fqn: "java.lang.Math", kind: "static" },
    ]);
  });

  it("ignores commented-out imports", () => {
    const src = `// import com.dead.Class;\n/* import com.block.Thing; */\nimport com.live.Real;`;
    expect(parseJavaImports(src)).toEqual([
      { fqn: "com.live.Real", kind: "single" },
    ]);
  });

  it("returns an empty array when there are no imports", () => {
    expect(parseJavaImports(`package com.app;\npublic class App {}`)).toEqual([]);
  });

  it("drops the member from a two-segment static import", () => {
    expect(parseJavaImports(`import static Foo.method;`)).toEqual([
      { fqn: "Foo", kind: "static" },
    ]);
  });

  it("does not treat 'staticFoo.Bar' as a static import", () => {
    expect(parseJavaImports(`import staticFoo.Bar;`)).toEqual([
      { fqn: "staticFoo.Bar", kind: "single" },
    ]);
  });

  it("does not let a '/*' inside a string literal swallow a later import", () => {
    const src = `class X { String s = "an open /* marker"; }\nimport com.real.Two;`;
    expect(parseJavaImports(src)).toEqual([
      { fqn: "com.real.Two", kind: "single" },
    ]);
  });

  it("does not let a '/*' inside a text block swallow a later import", () => {
    const src = `class X { String s = """\nan open /* marker in a text block\n"""; }\nimport com.real.Six;`;
    expect(parseJavaImports(src)).toEqual([
      { fqn: "com.real.Six", kind: "single" },
    ]);
  });
});
