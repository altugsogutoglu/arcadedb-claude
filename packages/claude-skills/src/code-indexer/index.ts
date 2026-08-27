export { indexRepo } from "./indexer.js";
export type { IndexOptions, IndexSummary } from "./indexer.js";
export { walkRepo } from "./walker.js";
export { detectLanguage, type Language } from "./languages.js";
export { detectModule } from "./modules.js";
export { parseTsImports } from "./parsers/ts-imports.js";
export { parsePhpImports } from "./parsers/php-imports.js";
export { resolveRelative, resolvePsr4, type Psr4Map } from "./resolvers/path.js";
export {
  upsertRepo, upsertModule, upsertFile, linkContains, linkImports,
  type RepoInput, type ModuleInput, type FileInput,
} from "./writer.js";
