import type { RecordedMedia, StreamEvent, StreamSpan } from '@manelly/shared';
import { channelsLabel, codecLabel, joinParts, resolutionLabel } from './format';

const LOCALE = 'de-CH';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Distances between two labels on the time axis. */
const TICKS = [5 * MINUTE, 10 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY];

/** Labels on full local hours and days, as few as fit. */
export function timeTicks(start: number, end: number, maxTicks: number): { interval: number; ticks: number[] } {
  const interval = TICKS.find((step) => (end - start) / step <= maxTicks) ?? TICKS.at(-1)!;
  const ticks: number[] = [];
  if (interval >= DAY) {
    // Days step by the calendar, so a change to summer time keeps them on midnight.
    const day = new Date(start);
    day.setHours(0, 0, 0, 0);
    for (; day.getTime() <= end; day.setDate(day.getDate() + interval / DAY)) if (day.getTime() >= start) ticks.push(day.getTime());
  } else {
    // On the local clock: 14:00, not 13:00 UTC.
    const offset = new Date(start).getTimezoneOffset() * MINUTE;
    for (let t = Math.ceil((start - offset) / interval) * interval + offset; t <= end; t += interval) ticks.push(t);
  }
  return { interval, ticks };
}

export function formatTick(t: number, interval: number): string {
  const date = new Date(t);
  if (interval >= DAY) return date.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'numeric' });
  const time = date.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
  // Midnight gets the date, so a long range stays readable.
  return date.getHours() === 0 && date.getMinutes() === 0 ? date.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'numeric' }) : time;
}

/** "Mo, 27.10. 14:05" – with seconds for short ranges. */
export function formatMoment(t: number, withSeconds = false): string {
  const date = new Date(t);
  const day = date.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'numeric' });
  const time = date.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}) });
  return `${day} ${time}`;
}

/** "Mo, 27.10. 13:00 – 14:00", the date only once when both are on the same day. */
export function formatRange(from: number, to: number): string {
  const sameDay = new Date(from).toDateString() === new Date(to).toDateString();
  const end = sameDay ? new Date(to).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' }) : formatMoment(to);
  return `${formatMoment(from)} – ${end}`;
}

/** "45 s", "12 min", "1 h 05 min", "2 Tage 3 h". */
export function formatSpan(ms: number): string {
  const minutes = Math.round(ms / MINUTE);
  if (ms < MINUTE) return `${Math.max(1, Math.round(ms / 1000))} s`;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h${minutes % 60 ? ` ${String(minutes % 60).padStart(2, '0')} min` : ''}`;
  return `${Math.floor(hours / 24)} Tage${hours % 24 ? ` ${hours % 24} h` : ''}`;
}

/** The point closest to t, if it lies within `maxDistance`; points are sorted by time. */
export function nearestPoint<T extends { t: number }>(points: T[], t: number, maxDistance: number): T | null {
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (points[middle]!.t < t) low = middle + 1;
    else high = middle;
  }
  const candidates = [points[low - 1], points[low]].filter((point): point is T => point !== undefined);
  const best = candidates.sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
  return best && Math.abs(best.t - t) <= maxDistance ? best : null;
}

/** A round top for a scale: 1, 2 or 5 times a power of ten, at least the value. */
export function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 5, 10].find((factor) => factor * power >= value) ?? 10) * power;
}

/** Where a stream's bar ends: at its stop, at the end of the range while it plays, otherwise at its last record. */
export function spanEnd(span: StreamSpan, to: number): number {
  return span.end ?? (span.ongoing ? to : span.phases.at(-1)!.t);
}

/** Puts the streams in rows so that no two bars touch; `x` turns a time into pixels. */
export function packLanes(spans: StreamSpan[], to: number, x: (t: number) => number, minWidth: number, gap = 4): Map<string, number> {
  const lanes: number[] = [];
  const result = new Map<string, number>();
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    const left = x(span.start);
    const right = Math.max(x(spanEnd(span, to)), left + minWidth);
    let lane = lanes.findIndex((occupiedUntil) => occupiedUntil + gap <= left);
    if (lane === -1) lane = lanes.push(right) - 1;
    else lanes[lane] = right;
    result.set(span.id + span.start, lane);
  }
  return result;
}

const RANGES: Record<string, string> = { HDR10: 'HDR10', HDR10Plus: 'HDR10+', HLG: 'HLG' };

/** "HEVC 4K Dolby Vision · TrueHD 7.1". */
export function describeMedia(media: RecordedMedia): string {
  const range = media.videoRange?.startsWith('DOVI') ? 'Dolby Vision' : media.videoRange ? (RANGES[media.videoRange] ?? null) : null;
  const video = joinParts([codecLabel(media.videoCodec), resolutionLabel(null, media.height), range]).replaceAll(' · ', ' ');
  const audio = joinParts([codecLabel(media.audioCodec), channelsLabel(media.audioChannels)]).replaceAll(' · ', ' ');
  return joinParts([video, audio]);
}

/** What Jellyfin sends instead: "H.264 1080p · AAC Stereo", copied parts named as such. */
export function describeTranscoding(phase: StreamEvent): string | null {
  const transcoding = phase.transcoding;
  if (!transcoding) return null;
  const video = transcoding.videoDirect ? 'Video kopiert' : joinParts([codecLabel(transcoding.videoCodec), resolutionLabel(null, transcoding.height)]).replaceAll(' · ', ' ');
  const audio = transcoding.audioDirect ? 'Ton kopiert' : joinParts([codecLabel(transcoding.audioCodec), channelsLabel(transcoding.audioChannels)]).replaceAll(' · ', ' ');
  return joinParts([video, audio]);
}
