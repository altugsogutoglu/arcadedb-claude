import { posix } from "node:path";

export function resolveRelative(fromFile: string, spec: string): string {
  if (!spec.startsWith(".")) return spec;
  const fromDir = posix.dirname(fromFile);
  const joined = posix.normalize(posix.join(fromDir, spec));
  return joined;
}

export type Psr4Map = Record<string, string>;

export function resolvePsr4(fqn: string, map: Psr4Map): string | null {
  const sortedPrefixes = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const prefix of sortedPrefixes) {
    if (fqn.startsWith(prefix)) {
      const rest = fqn.slice(prefix.length).replace(/\\/g, "/");
      return `${map[prefix]}${rest}.php`;
    }
  }
  return null;
}
