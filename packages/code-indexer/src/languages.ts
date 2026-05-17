export type Language = "ts" | "js" | "php" | "other";

const TS_EXT = new Set([".ts", ".tsx"]);
const JS_EXT = new Set([".js", ".jsx", ".mjs", ".cjs"]);
const PHP_EXT = new Set([".php"]);

export function detectLanguage(path: string): Language {
  const ext = extOf(path);
  if (TS_EXT.has(ext)) return "ts";
  if (JS_EXT.has(ext)) return "js";
  if (PHP_EXT.has(ext)) return "php";
  return "other";
}

function extOf(path: string): string {
  const i = path.lastIndexOf(".");
  if (i === -1) return "";
  return path.slice(i).toLowerCase();
}
