import type { StreamEvent, StreamSpan } from '@manelly/shared';
import { describe, expect, it } from 'vitest';
import { describeMedia, describeTranscoding, formatSpan, nearestPoint, niceCeil, packLanes, timeTicks } from './timeline';

const at = (hours: number, minutes = 0) => new Date(2026, 9, 27, hours, minutes).getTime();

describe('timeTicks', () => {
  it('puts labels on full local hours, as few as fit', () => {
    const { interval, ticks } = timeTicks(at(9, 40), at(15, 10), 6);
    expect(interval).toBe(3_600_000);
    expect(ticks.map((t) => new Date(t).getHours())).toEqual([10, 11, 12, 13, 14, 15]);
  });

  it('steps by days for long ranges', () => {
    const { ticks } = timeTicks(at(9), at(9) + 3 * 86_400_000, 4);
    expect(ticks.map((t) => [new Date(t).getDate(), new Date(t).getHours()])).toEqual([
      [28, 0],
      [29, 0],
      [30, 0],
    ]);
  });
});

describe('timeline helpers', () => {
  it('finds the nearest point within reach', () => {
    const points = [{ t: 0 }, { t: 15 }, { t: 30 }, { t: 90 }];
    expect(nearestPoint(points, 20, 15)).toEqual({ t: 15 });
    expect(nearestPoint(points, 29, 15)).toEqual({ t: 30 });
    expect(nearestPoint(points, 60, 15)).toBeNull();
    expect(nearestPoint([], 60, 15)).toBeNull();
  });

  it('rounds a scale up to 1, 2 or 5 times a power of ten', () => {
    expect([0, 3, 12, 48_000_000, 100].map(niceCeil)).toEqual([1, 5, 20, 50_000_000, 100]);
  });

  it('formats a duration', () => {
    expect([20_000, 12 * 60_000, 65 * 60_000, 50 * 3_600_000].map(formatSpan)).toEqual(['20 s', '12 min', '1 h 05 min', '2 Tage 2 h']);
  });

  it('packs streams into as few rows as possible without overlap', () => {
    const span = (id: string, start: number, end: number | null, ongoing = false) => ({ id, start, end, ongoing, phases: [{ t: start } as StreamEvent] }) as StreamSpan;
    const lanes = packLanes([span('a', 0, 50), span('b', 10, 30), span('c', 60, null, true), span('d', 35, 40)], 100, (t) => t, 2);
    expect([...lanes.values()]).toEqual([0, 1, 1, 0]);
  });

  it('describes source and transcode in a few words', () => {
    expect(describeMedia({ container: 'mkv', videoCodec: 'hevc', height: 2160, videoRange: 'DOVIWithHDR10', audioCodec: 'truehd', audioChannels: 8 })).toBe('HEVC 4K Dolby Vision · TrueHD 7.1');
    const phase = {
      transcoding: { container: 'ts', videoCodec: 'h264', height: 1080, videoRange: null, audioCodec: null, audioChannels: null, videoDirect: false, audioDirect: true, hardware: 'qsv' },
    } as StreamEvent;
    expect(describeTranscoding(phase)).toBe('H.264 1080p · Ton kopiert');
  });
});
