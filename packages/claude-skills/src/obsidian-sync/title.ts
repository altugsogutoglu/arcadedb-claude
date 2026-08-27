import { basename } from "node:path";
import type { Frontmatter } from "./frontmatter.js";

const H1_RE = /^#\s+(.+?)\s*$/m;

export function resolveTitle(relPath: string, body: string, frontmatter: Frontmatter): string {
  const fmTitle = frontmatter["title"];
  if (typeof fmTitle === "string" && fmTitle.trim().length > 0) {
    return fmTitle.trim();
  }
  const m = body.match(H1_RE);
  if (m) return m[1]!.trim();
  return basename(relPath, ".md");
}
