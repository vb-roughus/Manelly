import type { ConversionSchedule } from '@manelly/shared';

/** Whether the schedule holds conversions back at all. */
export const restricts = (schedule: ConversionSchedule) => schedule.window !== null || schedule.idleOnly;

/** "zwischen 01:00 und 06:00, wenn niemand streamt" – null when there is nothing to wait for. */
export function describeSchedule(schedule: ConversionSchedule): string | null {
  const parts = [
    schedule.window && `zwischen ${schedule.window.start} und ${schedule.window.end}`,
    schedule.idleOnly && 'wenn niemand streamt',
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** Shown when the browser runs in another time zone than the Jellyfin server. */
export function foreignTimeZone(timeZone: string): string | null {
  const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return timeZone && timeZone !== own ? timeZone : null;
}
