import type { CopyThrottle } from '@manelly/shared';
import { createJellyfinApi, type JfSession } from './jellyfin.js';
import type { SettingsStore } from './schedule.js';

/** Kept free on top of the streams, in bits per second. */
export const STREAM_RESERVE_BPS = 20_000_000;
/** A stream whose file tells no bitrate counts like a UHD remux. */
const UNKNOWN_STREAM_BPS = 80_000_000;
/** Copying never stops completely; it just gets slow (8 Mbit/s). */
const MIN_COPY_BYTES = 1_000_000;
/** Mbit/s → bytes per second. */
const MBIT_BYTES = 1_000_000 / 8;

/** What a stream reads from the storage: the bitrate of its whole file, all tracks. */
export function sourceBitrate(session: JfSession): number {
  const total = (session.NowPlayingItem?.MediaStreams ?? []).reduce((sum, stream) => sum + (stream.BitRate ?? 0), 0);
  return total > 0 ? total : UNKNOWN_STREAM_BPS;
}

export interface CopyLimiterOptions {
  settings: Pick<SettingsStore, 'get'>;
  fetch?: typeof fetch;
  now?: () => number;
  /** How often to look at the streams while something copies with the automatic limit. */
  checkMs?: number;
}

/**
 * How fast conversions may copy to and from the work folder right now. Automatically, the copy gets what the storage
 * manages minus the running streams and a reserve; Jellyfin is asked only while something copies.
 */
export function createCopyLimiter({ settings, fetch: fetchImpl = fetch, now = Date.now, checkMs = 15_000 }: CopyLimiterOptions) {
  let streams: { count: number; bitsPerSecond: number } = { count: 0, bitsPerSecond: 0 };
  let checkedAt = Number.NEGATIVE_INFINITY;
  let looking: Promise<void> | null = null;

  async function look() {
    const { jellyfin } = settings.get();
    try {
      if (!jellyfin) throw new Error('Keine Jellyfin-Verbindung.');
      const playing = (await createJellyfinApi(jellyfin, fetchImpl).sessions()).filter((session) => session.NowPlayingItem);
      streams = { count: playing.length, bitsPerSecond: playing.reduce((sum, session) => sum + sourceBitrate(session), 0) };
    } catch {
      // Without knowing about streams, make room for one.
      streams = { count: 1, bitsPerSecond: UNKNOWN_STREAM_BPS };
    }
  }

  return {
    /** null: copy at full speed. */
    current(): CopyThrottle | null {
      const { mode, limitMbps, storageMbps } = settings.get().copyLimit;
      if (mode === 'off') return null;
      if (mode === 'always') return { bytesPerSecond: limitMbps * MBIT_BYTES, streams: null, streamsBitsPerSecond: null };
      if (!looking && now() - checkedAt >= checkMs) {
        checkedAt = now();
        looking = look().finally(() => {
          looking = null;
        });
      }
      if (streams.count === 0) return null;
      const left = storageMbps * MBIT_BYTES - (streams.bitsPerSecond + STREAM_RESERVE_BPS) / 8;
      return { bytesPerSecond: Math.max(MIN_COPY_BYTES, Math.round(left)), streams: streams.count, streamsBitsPerSecond: streams.bitsPerSecond };
    },

    /** The look at the streams that current() started, if any; for tests. */
    settled: (): Promise<void> => looking ?? Promise.resolve(),
  };
}

export type CopyLimiter = ReturnType<typeof createCopyLimiter>;
