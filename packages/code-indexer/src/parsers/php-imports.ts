const SIMPLE_USE_RE = /^\s*use\s+([\w\\]+)(?:\s+as\s+\w+)?\s*;/gm;
const GROUPED_USE_RE = /^\s*use\s+([\w\\]+)\\\{\s*([^}]+)\}\s*;/gm;

export function parsePhpImports(source: string): string[] {
  const out: { idx: number; fqn: string }[] = [];

  GROUPED_USE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = GROUPED_USE_RE.exec(source)) !== null) {
    const base = m[1]!;
    const parts = m[2]!.split(",").map(s => s.trim()).filter(Boolean);
    let offset = 0;
    for (const part of parts) {
      const fqn = `${base}\\${part.split(/\s+as\s+/i)[0]!.trim()}`;
      out.push({ idx: m.index + offset, fqn });
      offset++;
    }
  }

  SIMPLE_USE_RE.lastIndex = 0;
  while ((m = SIMPLE_USE_RE.exec(source)) !== null) {
    if (/\\\{/.test(m[0])) continue;
    out.push({ idx: m.index, fqn: m[1]! });
  }

  out.sort((a, b) => a.idx - b.idx);
  return out.map(x => x.fqn);
}
