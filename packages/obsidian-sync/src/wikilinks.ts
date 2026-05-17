const WIKILINK_RE = /!?\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

export function extractWikilinks(source: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(source)) !== null) {
    const target = m[1]!.trim();
    if (!seen.has(target)) {
      seen.add(target);
      out.push(target);
    }
  }
  return out;
}
