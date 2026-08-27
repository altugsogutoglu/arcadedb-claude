import { describe, it, expect } from "vitest";
import { javaFqnForFile, resolveJavaImport } from "../../../src/code-indexer/resolvers/java.js";

describe("javaFqnForFile", () => {
  it("combines package and class name", () => {
    expect(javaFqnForFile("src/main/java/com/foo/Bar.java", "com.foo")).toBe("com.foo.Bar");
  });

  it("uses the bare class name for the default package", () => {
    expect(javaFqnForFile("Main.java", null)).toBe("Main");
  });
});

describe("resolveJavaImport", () => {
  const typeIndex = new Map<string, string>([
    ["com.foo.Bar", "src/main/java/com/foo/Bar.java"],
    ["com.foo.Util", "src/main/java/com/foo/Util.java"],
  ]);
  const packages = new Set<string>(["com.foo"]);

  it("resolves a single import to its file", () => {
    expect(resolveJavaImport({ fqn: "com.foo.Bar", kind: "single" }, typeIndex, packages))
      .toEqual({ kind: "file", path: "src/main/java/com/foo/Bar.java" });
  });

  it("resolves a static import to its class file", () => {
    expect(resolveJavaImport({ fqn: "com.foo.Util", kind: "static" }, typeIndex, packages))
      .toEqual({ kind: "file", path: "src/main/java/com/foo/Util.java" });
  });

  it("resolves a nested/inner class import to its outer class file", () => {
    expect(resolveJavaImport({ fqn: "com.foo.Bar.Inner", kind: "single" }, typeIndex, packages))
      .toEqual({ kind: "file", path: "src/main/java/com/foo/Bar.java" });
  });

  it("resolves a static member of a nested class to the outer class file", () => {
    expect(resolveJavaImport({ fqn: "com.foo.Bar.Inner", kind: "static" }, typeIndex, packages))
      .toEqual({ kind: "file", path: "src/main/java/com/foo/Bar.java" });
  });

  it("resolves a type wildcard to the package module", () => {
    expect(resolveJavaImport({ fqn: "com.foo", kind: "wildcard" }, typeIndex, packages))
      .toEqual({ kind: "module", pkg: "com.foo" });
  });

  it("reports a missing single import as unresolved", () => {
    expect(resolveJavaImport({ fqn: "java.util.List", kind: "single" }, typeIndex, packages))
      .toEqual({ kind: "unresolved", spec: "java.util.List" });
  });

  it("reports a wildcard for an unknown package as unresolved (with .*)", () => {
    expect(resolveJavaImport({ fqn: "org.external", kind: "wildcard" }, typeIndex, packages))
      .toEqual({ kind: "unresolved", spec: "org.external.*" });
  });
});
