export type FrontmatterValue = string | string[];

export interface Frontmatter {
  [key: string]: FrontmatterValue;
}

export interface ParsedNote {
  frontmatter: Frontmatter;
  body: string;
}

const FENCE_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

export function parseFrontmatter(source: string): ParsedNote {
  const m = source.match(FENCE_RE);
  if (!m) {
    return { frontmatter: {}, body: source };
  }
  const yaml = m[1] ?? "";
  const body = source.slice(m[0].length);
  return { frontmatter: parseYaml(yaml), body };
}

function parseYaml(input: string): Frontmatter {
  const out: Frontmatter = {};
  const lines = input.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const m = line.match(/^(\w[\w.-]*)\s*:\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1]!;
    const inlineValue = m[2]!.trim();

    if (inlineValue === "") {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const item = lines[j]!.match(/^\s*-\s+(.+)$/);
        if (!item) break;
        items.push(stripQuotes(item[1]!.trim()));
        j++;
      }
      if (items.length > 0) {
        out[key] = items;
        i = j;
        continue;
      }
    }

    if (inlineValue.startsWith("[") && inlineValue.endsWith("]")) {
      const inner = inlineValue.slice(1, -1);
      out[key] = inner.split(",").map(s => stripQuotes(s.trim())).filter(s => s.length > 0);
      i++;
      continue;
    }

    out[key] = stripQuotes(inlineValue);
    i++;
  }
  return out;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
