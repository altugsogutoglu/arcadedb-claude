import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";

export function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function createLock(path: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, "wx");
  } catch {
    return false;
  }
  try {
    writeSync(fd, String(process.pid));
  } finally {
    closeSync(fd);
  }
  return true;
}

/** Exclusive create, so two runners racing on the same key cannot both win. */
export function acquireLock(path: string): boolean {
  if (createLock(path)) return true;
  // Lock exists: only a dead holder may be cleared, and only once.
  let pid = NaN;
  try {
    pid = Number(readFileSync(path, "utf8").trim());
  } catch {
    return false;
  }
  if (Number.isFinite(pid) && pid > 0 && pidAlive(pid)) return false;
  try {
    unlinkSync(path);
  } catch {
    return false;
  }
  return createLock(path);
}
