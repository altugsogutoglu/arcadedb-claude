import type { JavaImport } from "../parsers/java-imports.js";

export type JavaResolution =
  | { kind: "file"; path: string }
  | { kind: "module"; pkg: string }
  | { kind: "unresolved"; spec: string };

/** A Java file's FQN is its package plus the class name taken from the filename. */
export function javaFqnForFile(relPath: string, pkg: string | null): string {
  // Split on both separators so the class name is extracted correctly when the
  // walker emits native (backslash) paths on Windows.
  const file = relPath.split(/[/\\]/).pop() ?? relPath;
  const base = file.replace(/\.java$/, "");
  return pkg ? `${pkg}.${base}` : base;
}

export function resolveJavaImport(
  imp: JavaImport,
  typeIndex: Map<string, string>,
  packages: Set<string>,
): JavaResolution {
  if (imp.kind === "wildcard") {
    if (packages.has(imp.fqn)) return { kind: "module", pkg: imp.fqn };
    return { kind: "unresolved", spec: `${imp.fqn}.*` };
  }
  // single / static: look up the class FQN. Walk parent segments so an import
  // of a nested/inner class (com.foo.Bar.Inner) resolves to its top-level file
  // (com.foo.Bar -> Bar.java), as the design specifies.
  let current = imp.fqn;
  while (current) {
    const path = typeIndex.get(current);
    if (path) return { kind: "file", path };
    const lastDot = current.lastIndexOf(".");
    if (lastDot === -1) break;
    current = current.slice(0, lastDot);
  }
  return { kind: "unresolved", spec: imp.fqn };
}
