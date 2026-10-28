import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CopyLimit } from '@manelly/shared';
import { createCopyLimiter, sourceBitrate } from '../src/copyLimit.js';
import { createSettingsStore, DEFAULT_COPY_LIMIT, type AgentSettings } from '../src/schedule.js';

/** A session playing a file with these track bitrates. */
const playing = (...bitrates: number[]) => ({ NowPlayingItem: { Name: 'Film', MediaStreams: bitrates.map((BitRate) => ({ Type: 'Video', BitRate })) } });

function setup(copyLimit: CopyLimit, jellyfin: AgentSettings['jellyfin'] = { url: 'http://jellyfin:8096', apiKey: 'key' }) {
  const world = { sessions: [] as unknown[], reachable: true, clock: 0, calls: 0 };
  const limiter = createCopyLimiter({
    settings: { get: () => ({ copyLimit, jellyfin }) as AgentSettings },
    fetch: async () => {
      world.calls++;
      if (!world.reachable) throw new Error('offline');
      return Response.json([{ DeviceName: 'Manelly' }, ...world.sessions]);
    },
    now: () => world.clock,
    checkMs: 1000,
  });
  return { world, limiter };
}

describe('copy limit', () => {
  it('copies at full speed, or always limited, without asking Jellyfin', () => {
    const off = setup(DEFAULT_COPY_LIMIT);
    expect(off.limiter.current()).toBeNull();
    const always = setup({ mode: 'always', limitMbps: 400, storageMbps: 1600 });
    expect(always.limiter.current()).toEqual({ bytesPerSecond: 50_000_000, streams: null, streamsBitsPerSecond: null });
    expect([off.world.calls, always.world.calls]).toEqual([0, 0]);
  });

  it('leaves the storage to the running streams and a reserve, and copies at full speed without them', async () => {
    const { world, limiter } = setup({ mode: 'streaming', limitMbps: 400, storageMbps: 1600 });
    expect(limiter.current()).toBeNull();
    await limiter.settled();
    expect(limiter.current()).toBeNull();

    // 85 % of 1600 Mbit/s less two streams of 80 and 40 Mbit/s and 20 Mbit/s reserve: 1220 Mbit/s = 152.5 MB (decimal) per second.
    world.sessions = [playing(78_000_000, 2_000_000), playing(40_000_000)];
    world.clock = 2000;
    limiter.current();
    await limiter.settled();
    expect(limiter.current()).toEqual({ bytesPerSecond: 152_500_000, streams: 2, streamsBitsPerSecond: 120_000_000 });

    // Jellyfin is asked at most once a second here.
    const calls = world.calls;
    world.clock = 2500;
    limiter.current();
    expect(world.calls).toBe(calls);

    // More streams than the storage manages: copying slows down to a crawl, but does not stop.
    world.sessions = Array.from({ length: 30 }, () => playing(80_000_000));
    world.clock = 4000;
    limiter.current();
    await limiter.settled();
    expect(limiter.current()?.bytesPerSecond).toBe(1_000_000);

    world.sessions = [];
    world.clock = 6000;
    limiter.current();
    await limiter.settled();
    expect(limiter.current()).toBeNull();
  });

  it('makes room for one stream when it cannot know about streams', async () => {
    const { world, limiter } = setup({ mode: 'streaming', limitMbps: 400, storageMbps: 1600 });
    world.reachable = false;
    limiter.current();
    await limiter.settled();
    // 1360 − 80 − 20 = 1260 Mbit/s.
    expect(limiter.current()).toEqual({ bytesPerSecond: 157_500_000, streams: 1, streamsBitsPerSecond: 80_000_000 });

    const unknown = setup({ mode: 'streaming', limitMbps: 400, storageMbps: 1600 }, null);
    unknown.limiter.current();
    await unknown.limiter.settled();
    expect(unknown.limiter.current()?.streams).toBe(1);
  });

  it('reads a limit stored in MB/s before 0.23.0 in Mbit/s', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'copy-limit-'));
    try {
      await writeFile(path.join(dir, 'settings.json'), JSON.stringify({ copyLimit: { mode: 'streaming', limitMBps: 50, storageMBps: 200 } }));
      expect((await createSettingsStore(dir)).get().copyLimit).toEqual({ mode: 'streaming', limitMbps: 419, storageMbps: 1678 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('counts a stream by its whole file, or like a UHD remux when the file tells nothing', () => {
    expect(sourceBitrate(playing(60_000_000, 4_000_000, 1_500_000))).toBe(65_500_000);
    expect(sourceBitrate({ NowPlayingItem: { Name: 'Film' } })).toBe(80_000_000);
  });
});
