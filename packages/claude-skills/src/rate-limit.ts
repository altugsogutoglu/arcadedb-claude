export interface RateLimitState {
  currentTurnIdx: number;
  lastExtractedTurnIdx: number;
  lastExtractedAt: string; // ISO
}

export interface RateLimitConfig {
  turns: number;
  intervalMs: number;
}

export function shouldExtract(
  state: RateLimitState,
  cfg: RateLimitConfig,
  now: Date,
): boolean {
  const delta = state.currentTurnIdx - state.lastExtractedTurnIdx;
  if (delta <= 0) return false;
  if (delta >= cfg.turns) return true;
  const last = new Date(state.lastExtractedAt).getTime();
  if (Number.isNaN(last)) return false;
  return now.getTime() - last >= cfg.intervalMs;
}
