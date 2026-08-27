import type { ResolvedConfig } from "./config.js";
import type { ProjectsMap } from "./project-map.js";

/**
 * projects.json's defaultMemoryDb stays authoritative unless ARCADEDB_MEMORY_DB
 * was set explicitly (shell env or ~/.config/arcadedb/.env).
 */
export function resolveMemoryDb(cfg: ResolvedConfig, map: ProjectsMap): string {
  return cfg.sources.memoryDb === "default" ? map.defaultMemoryDb : cfg.memoryDb;
}
