const DAY = 86_400_000;
/** Kept longer than this: time to look whether it is still needed. */
export const OLD_DAYS = 30;
export const STALE_DAYS = 90;

/** How long an original has been kept: in days, and whether that is long (yellow) or very long (red). */
export function originalAge(archivedAt: string, now: number): { days: number; tone: 'fresh' | 'old' | 'stale' } {
  const days = Math.max(0, Math.floor((now - Date.parse(archivedAt)) / DAY));
  return { days, tone: days > STALE_DAYS ? 'stale' : days > OLD_DAYS ? 'old' : 'fresh' };
}
