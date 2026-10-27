import { describe, expect, it } from 'vitest';
import type { NowPlayingItem } from '@manelly/shared';
import { formatBitrate, formatDuration, formatEta, formatSpeed, itemHeadline, languageLabel, resolutionLabel } from './format';
import { describeTranscodeReason } from './transcodeReasons';

const item = (overrides: Partial<NowPlayingItem>): NowPlayingItem => ({
  id: 'x',
  type: 'Movie',
  name: 'Name',
  seriesName: null,
  seasonNumber: null,
  episodeNumber: null,
  album: null,
  artists: [],
  productionYear: null,
  durationMs: null,
  videoType: null,
  poster: null,
  backdrop: null,
  ...overrides,
});

describe('format', () => {
  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(754_000)).toBe('12:34');
    expect(formatDuration(4_520_000)).toBe('1:15:20');
  });

  it('formats bitrates', () => {
    expect(formatBitrate(8_200_000)).toBe('8.2 Mbit/s');
    expect(formatBitrate(320_000)).toBe('320 kbit/s');
    expect(formatBitrate(120_000_000)).toBe('120 Mbit/s');
  });

  it('labels resolutions, including cropped widescreen', () => {
    expect(resolutionLabel(3840, 1600)).toBe('4K');
    expect(resolutionLabel(1920, 800)).toBe('1080p');
    expect(resolutionLabel(1280, 720)).toBe('720p');
    expect(resolutionLabel(null, null)).toBeNull();
  });

  it('translates Jellyfin language codes', () => {
    expect(languageLabel('ger')).toBe('Deutsch');
    expect(languageLabel('eng')).toBe('Englisch');
    expect(languageLabel('und')).toBeNull();
  });

  it('builds headlines per item type', () => {
    expect(itemHeadline(item({ type: 'Episode', name: 'Pilot', seriesName: 'Serie', seasonNumber: 1, episodeNumber: 2 }))).toEqual({
      title: 'Serie',
      subtitle: 'S01E02 · Pilot',
    });
    expect(itemHeadline(item({ type: 'Audio', name: 'Song', artists: ['Band'], album: 'Album' }))).toEqual({
      title: 'Song',
      subtitle: 'Band · Album',
    });
    expect(itemHeadline(item({ name: 'Film', productionYear: 2024 }))).toEqual({ title: 'Film', subtitle: '2024' });
  });

  it('describes unknown transcode reasons readably', () => {
    expect(describeTranscodeReason('VideoCodecNotSupported').label).toBe('Video-Codec nicht unterstützt');
    expect(describeTranscodeReason('SomeFutureReason').label).toBe('Some Future Reason');
  });
});

describe('downloads', () => {
  it('formats download speed and time to go', () => {
    expect(formatSpeed(2_500_000)).toBe('2.4 MB/s');
    expect(formatSpeed(870_000)).toBe('850 KB/s');
    expect(formatSpeed(150 * 1024 ** 2)).toBe('150 MB/s');
    expect([formatEta(42), formatEta(720), formatEta(3900), formatEta(7200)]).toEqual(['42 s', '12 min', '1 h 5 min', '2 h']);
  });
});
