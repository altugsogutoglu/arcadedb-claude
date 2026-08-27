import type { Frontmatter } from "./frontmatter.js";

const INLINE_TAG_RE = /(?:^|\s)#([\w-]*[A-Za-z_-][\w-]*)/g;

export function extractTags(body: string, frontmatter: Frontmatter): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const fmTags = frontmatter["tags"];
  if (fmTags) {
    const items = Array.isArray(fmTags) ? fmTags : [fmTags];
    for (const item of items) {
      const t = String(item).trim();
      if (t && !seen.has(t)) { seen.add(t); out.push(t); }
    }
  }

  const cleanedBody = stripCodeAndIndented(body);
  INLINE_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_TAG_RE.exec(cleanedBody)) !== null) {
    const tag = m[1]!;
    if (!seen.has(tag)) { seen.add(tag); out.push(tag); }
  }

  return out;
}

function stripCodeAndIndented(src: string): string {
  return src.split("\n")
    .filter(line => !line.startsWith("    ") && !line.startsWith("\t"))
    .join("\n");
}
