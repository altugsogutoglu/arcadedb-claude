export { syncVault } from "./syncer.js";
export type { SyncOptions, SyncSummary } from "./syncer.js";
export { walkVault } from "./walker.js";
export { parseFrontmatter } from "./frontmatter.js";
export type { Frontmatter, FrontmatterValue, ParsedNote } from "./frontmatter.js";
export { extractWikilinks } from "./wikilinks.js";
export { extractTags } from "./tags.js";
export { resolveTitle } from "./title.js";
export {
  upsertNote, upsertTag, linkLinksTo, linkTagged,
  type NoteInput, type TagInput,
} from "./writer.js";
