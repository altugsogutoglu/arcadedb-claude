export type RefKind = "path" | "symbol" | "commit" | "ticket" | "url";

export interface Ref {
  kind: RefKind;
  value: string;
}

/** Most refs one turn may carry; a pasted diff or file list stops here. */
export const MAX_REFS_PER_TURN = 30;

const URL_RE = /https?:\/\/[^\s)>\]"'`]+/g;
/** At least one directory separator and an extension: `config/heisterkamp.php`, `src/a/b.ts`. */
const PATH_RE = /(?:^|[\s(`'"[])((?:\.{0,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.[a-z0-9]{1,6})(?=[\s)`'":,;\]]|$)/gi;
/** Git short/long SHA; must mix digits and letters so plain numbers and words stay out. */
const SHA_RE = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g;
/** `BACKLOG:69`, `ABC-123`, `GH-4`. */
const TICKET_RE = /\b([A-Z][A-Z0-9]{1,9})[-:](\d{1,6})\b/g;
/** PascalCase with two or more humps: `HeisterkampClient`, `ConditionDefaultsEditor`. */
const SYMBOL_RE = /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b/g;

const TICKET_PREFIX_NOISE = new Set(["UTF", "ISO", "SHA", "MD", "HTTP", "TLS", "SSL", "AES", "RSA", "IPV", "ES", "PHP", "H", "P", "V"]);

/**
 * Pull the identifiers a turn names, without a model: file paths, class-like symbols,
 * commit SHAs, ticket ids and URLs. Order is stable, duplicates collapse, output is capped.
 */
export function extractRefs(text: string): Ref[] {
  const seen = new Set<string>();
  const out: Ref[] = [];
  const push = (kind: RefKind, raw: string): void => {
    const value = raw.trim();
    if (!value) return;
    const key = `${kind}:${value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, value });
  };

  for (const m of text.matchAll(URL_RE)) push("url", m[0].replace(/[.,;:]+$/, ""));
  // Strip URLs before the path scan so `https://x.y/a/b.php` is not also a path.
  const noUrls = text.replace(URL_RE, " ");
  for (const m of noUrls.matchAll(PATH_RE)) push("path", m[1]!.replace(/^\.\//, ""));
  for (const m of noUrls.matchAll(SHA_RE)) push("commit", m[0].toLowerCase());
  for (const m of noUrls.matchAll(TICKET_RE)) {
    if (TICKET_PREFIX_NOISE.has(m[1]!)) continue;
    push("ticket", `${m[1]}:${m[2]}`);
  }
  for (const m of noUrls.matchAll(SYMBOL_RE)) {
    if (m[0].length < 6) continue;
    push("symbol", m[0]);
  }
  return out.slice(0, MAX_REFS_PER_TURN);
}

export function refId(ref: Ref): string {
  return `${ref.kind}:${ref.value.toLowerCase()}`;
}
