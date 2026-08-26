import { readFileSync } from "node:fs";

export function countTranscriptLines(path: string | undefined): number {
  if (!path) return 0;
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    return 0;
  }
  if (buf.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a) n++;
  if (buf[buf.length - 1] !== 0x0a) n++;
  return n;
}
