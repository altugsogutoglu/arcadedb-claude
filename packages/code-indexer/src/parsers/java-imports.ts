export interface JavaImport {
  /** The class FQN (single/static) or package name (wildcard) to resolve. */
  fqn: string;
  kind: "single" | "static" | "wildcard";
}

const PACKAGE_RE = /^\s*package\s+([\w.]+)\s*;/m;
const IMPORT_RE = /^\s*import\s+(?:(static)\s+)?([\w.]+(?:\.\*)?)\s*;/gm;

export function parseJavaPackage(source: string): string | null {
  const m = PACKAGE_RE.exec(stripComments(source));
  return m ? m[1]! : null;
}

export function parseJavaImports(source: string): JavaImport[] {
  const stripped = stripComments(source);
  const out: JavaImport[] = [];
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(stripped)) !== null) {
    const isStatic = Boolean(m[1]);
    const ref = m[2]!;
    if (isStatic) {
      // Drop the trailing member (a name or '*') to get the owning class FQN.
      out.push({ fqn: dropLastSegment(ref), kind: "static" });
    } else if (ref.endsWith(".*")) {
      out.push({ fqn: ref.slice(0, -2), kind: "wildcard" });
    } else {
      out.push({ fqn: ref, kind: "single" });
    }
  }
  return out;
}

function dropLastSegment(fqn: string): string {
  const i = fqn.lastIndexOf(".");
  return i === -1 ? fqn : fqn.slice(0, i);
}

function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // Skip literals so comment markers inside them aren't misread as comments.
    // Text block ("""…""") first, since it starts with the same quote as a string.
    if (c === '"' && next === '"' && src[i + 2] === '"') {
      out += '"""';
      i += 3;
      while (i < n && !(src[i] === '"' && src[i + 1] === '"' && src[i + 2] === '"')) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += '"""';
      i += 3;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      out += quote;
      i++;
      while (i < n && src[i] !== quote && src[i] !== "\n") {
        if (src[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        out += " ";
        i++;
      }
      if (i < n && src[i] === quote) {
        out += quote;
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
