const IMPORT_RE = /^\s*import\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gm;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const REQUIRE_RE = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

export function parseTsImports(source: string): string[] {
  const stripped = stripComments(source);
  const out: { idx: number; spec: string }[] = [];
  for (const re of [IMPORT_RE, DYNAMIC_IMPORT_RE, REQUIRE_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
      if (!isInsideStringLiteral(stripped, m.index)) {
        out.push({ idx: m.index, spec: m[1]! });
      }
    }
  }
  out.sort((a, b) => a.idx - b.idx);
  return out.map(x => x.spec);
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
    out += c;
    i++;
  }
  return out;
}

function isInsideStringLiteral(src: string, pos: number): boolean {
  let inStr: string | null = null;
  for (let i = 0; i < pos; i++) {
    const c = src[i]!;
    if (inStr) {
      if (c === "\\" && i + 1 < pos) { i++; continue; }
      if (c === inStr) inStr = null;
    } else {
      if (c === '"' || c === "'" || c === "`") inStr = c;
    }
  }
  return inStr !== null;
}
