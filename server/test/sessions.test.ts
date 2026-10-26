import { describe, expect, it } from 'vitest';
import type { TranscodeLogInfo } from '@manelly/shared';
import { buildSessionsResponse, isPrivateAddress, resolvePlayMethod, toStreamSession, transcodedMediaSources } from '../src/sessions.js';
import type { JfSessionInfo } from '../src/jellyfin/types.js';
import { createTranscodingInfoRecovery } from '../src/transcodingInfo.js';

const movie: JfSessionInfo = {
  Id: 's1',
  UserId: 'u1',
  UserName: 'Anna',
  Client: 'Jellyfin Android TV',
  DeviceName: 'Wohnzimmer',
  RemoteEndPoint: '::ffff:192.168.1.20',
  NowPlayingItem: {
    Id: 'movie',
    Name: 'Film',
    Type: 'Movie',
    Container: 'mkv',
    RunTimeTicks: 60_000 * 10_000,
    ImageTags: { Primary: 'poster-tag' },
    BackdropImageTags: ['backdrop-tag'],
    MediaStreams: [
      { Type: 'Video', Index: 0, Codec: 'hevc', Width: 3840, Height: 2160, BitRate: 20_000_000 },
      { Type: 'Audio', Index: 1, Codec: 'eac3', Channels: 6, Language: 'ger', IsDefault: true, BitRate: 640_000 },
      { Type: 'Audio', Index: 2, Codec: 'aac', Channels: 2, Language: 'eng', BitRate: 192_000 },
      { Type: 'Subtitle', Index: 3, Codec: 'subrip', Language: 'ger', IsExternal: true },
    ],
  },
  PlayState: { PositionTicks: 30_000 * 10_000, PlayMethod: 'DirectPlay', AudioStreamIndex: 2, SubtitleStreamIndex: 3 },
};

describe('resolvePlayMethod', () => {
  it('reports direct play', () => {
    expect(resolvePlayMethod(movie)).toBe('DirectPlay');
  });

  it('treats a DirectStream play state without transcoding info as direct play, like Jellyfin', () => {
    expect(resolvePlayMethod({ PlayState: { PlayMethod: 'DirectStream' } })).toBe('DirectPlay');
  });

  it('distinguishes remux, direct stream and transcode via the transcoding info', () => {
    const transcode = (IsVideoDirect: boolean, IsAudioDirect: boolean): JfSessionInfo => ({
      PlayState: { PlayMethod: 'Transcode' },
      TranscodingInfo: { IsVideoDirect, IsAudioDirect },
    });
    expect(resolvePlayMethod(transcode(true, true))).toBe('Remux');
    expect(resolvePlayMethod(transcode(true, false))).toBe('DirectStream');
    expect(resolvePlayMethod(transcode(false, true))).toBe('Transcode');
  });
});

describe('toStreamSession', () => {
  it('maps the selected streams, position and images', () => {
    const stream = toStreamSession(movie);
    expect(stream.playback).toEqual({ positionMs: 30_000, isPaused: false, isMuted: false, method: 'DirectPlay' });
    expect(stream.item.durationMs).toBe(60_000);
    expect(stream.item.poster).toEqual({ itemId: 'movie', type: 'Primary', tag: 'poster-tag', aspect: 'portrait' });
    expect(stream.item.backdrop).toEqual({ itemId: 'movie', type: 'Backdrop', tag: 'backdrop-tag', aspect: 'landscape' });
    expect(stream.source.video?.codec).toBe('hevc');
    // The client picked the second audio track, not the default one.
    expect(stream.source.audio?.language).toBe('eng');
    expect(stream.source.subtitle).toMatchObject({ codec: 'subrip', isExternal: true });
    expect(stream.estimatedBitrate).toBe(20_192_000);
    expect(stream.remoteAddress).toBe('192.168.1.20');
    expect(stream.isLocalNetwork).toBe(true);
  });

  it('passes on the details needed to explain transcode reasons', () => {
    const stream = toStreamSession({
      ...movie,
      NowPlayingItem: {
        ...movie.NowPlayingItem,
        MediaStreams: [
          { Type: 'Video', Index: 0, Codec: 'hevc', VideoRange: 'HDR', VideoRangeType: 'DOVIWithEL', DvProfile: 7, Level: 153, CodecTag: 'dvhe' },
          { Type: 'Audio', Index: 1, Codec: 'truehd', Profile: 'Dolby TrueHD + Dolby Atmos', Channels: 8, SampleRate: 48_000, BitDepth: 24 },
        ],
      },
      PlayState: { PlayMethod: 'Transcode', AudioStreamIndex: 1 },
    });
    expect(stream.source.video).toMatchObject({ videoRangeType: 'DOVIWithEL', dvProfile: 7, level: 153, codecTag: 'dvhe', isInterlaced: false });
    expect(stream.source.audio).toMatchObject({ profile: 'Dolby TrueHD + Dolby Atmos', sampleRate: 48_000, bitDepth: 24 });
  });

  it('treats subtitle index -1 as subtitles off', () => {
    const stream = toStreamSession({ ...movie, PlayState: { ...movie.PlayState, SubtitleStreamIndex: -1 } });
    expect(stream.source.subtitle).toBeNull();
  });

  it('uses the series poster and parent backdrop for episodes', () => {
    const stream = toStreamSession({
      NowPlayingItem: {
        Id: 'ep',
        Type: 'Episode',
        SeriesId: 'series',
        SeriesPrimaryImageTag: 'series-tag',
        ParentBackdropItemId: 'series',
        ParentBackdropImageTags: ['series-backdrop'],
        ImageTags: { Primary: 'episode-still' },
      },
    });
    expect(stream.item.poster).toEqual({ itemId: 'series', type: 'Primary', tag: 'series-tag', aspect: 'portrait' });
    expect(stream.item.backdrop?.tag).toBe('series-backdrop');
  });

  it('prefers the transcoder bitrate and drops a "none" hardware acceleration', () => {
    const stream = toStreamSession({
      ...movie,
      PlayState: { PlayMethod: 'Transcode' },
      TranscodingInfo: {
        IsVideoDirect: false,
        IsAudioDirect: false,
        Bitrate: 8_000_000,
        HardwareAccelerationType: 'none',
        TranscodeReasons: ['VideoCodecNotSupported'],
      },
    });
    expect(stream.estimatedBitrate).toBe(8_000_000);
    expect(stream.transcoding?.hardwareAcceleration).toBeNull();
    expect(stream.transcoding?.reasons).toEqual(['VideoCodecNotSupported']);
  });
});

describe('buildSessionsResponse', () => {
  it('only lists sessions that play something and summarizes them', () => {
    const transcode: JfSessionInfo = {
      ...movie,
      Id: 's2',
      UserName: 'Bruno',
      PlayState: { PlayMethod: 'Transcode' },
      TranscodingInfo: { IsVideoDirect: false, Bitrate: 4_000_000, HardwareAccelerationType: 'qsv' },
    };
    const remux: JfSessionInfo = {
      ...movie,
      Id: 's3',
      UserName: 'Carla',
      TranscodingInfo: { IsVideoDirect: true, IsAudioDirect: true, Bitrate: 1_000_000 },
    };
    const idle: JfSessionInfo = { Id: 'idle', UserName: 'Dora' };

    const response = buildSessionsResponse([transcode, idle, remux, movie], new Date('2026-01-01T00:00:00Z'));

    expect(response.sessions.map((s) => s.user.name)).toEqual(['Anna', 'Bruno', 'Carla']);
    expect(response.idleSessions).toBe(1);
    expect(response.summary).toEqual({
      total: 3,
      directPlay: 1,
      directStream: 1,
      transcode: 1,
      hardwareTranscodes: 1,
      struggling: 0,
      estimatedBandwidth: 20_192_000 + 4_000_000 + 1_000_000,
    });
    expect(response.fetchedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('isPrivateAddress', () => {
  it.each([
    ['10.0.0.5', true],
    ['172.20.1.1', true],
    ['172.32.1.1', false],
    ['192.168.0.10', true],
    ['127.0.0.1', true],
    ['203.0.113.7', false],
    ['::1', true],
    ['fd12:3456::1', true],
    ['2001:db8::1', false],
    ['not-an-ip', false],
  ])('%s → %s', (address, expected) => {
    expect(isPrivateAddress(address)).toBe(expected);
  });
});

describe('missing transcoding info', () => {
  // Jellyfin Web in Chrome: the session says Transcode, but carries no TranscodingInfo.
  const browser: JfSessionInfo = {
    ...movie,
    Id: 'web1',
    Client: 'Jellyfin Web',
    DeviceName: 'Chrome',
    DeviceId: 'DEVICE-1',
    PlayState: { PlayMethod: 'Transcode', MediaSourceId: 'ms1', AudioStreamIndex: 1, IsPaused: true },
  };
  const info = { IsVideoDirect: false, IsAudioDirect: false, VideoCodec: 'h264', AudioCodec: 'aac', TranscodeReasons: ['VideoCodecNotSupported', 'AudioCodecNotSupported'] };

  it('takes it from an idle session of the same device, where Jellyfin reported it', () => {
    const recover = createTranscodingInfoRecovery();
    const idleTab: JfSessionInfo = { Id: 'web2', Client: 'Jellyfin Web', DeviceId: 'device-1', TranscodingInfo: { ...info, Framerate: 90 } };
    const { sessions, origins } = recover([idleTab, browser]);
    const stream = buildSessionsResponse(sessions, new Date(), null, new Map(), origins).sessions[0]!;
    expect(stream.transcoding).toMatchObject({ origin: 'sameDevice', videoCodec: 'h264', reasons: ['VideoCodecNotSupported', 'AudioCodecNotSupported'] });
  });

  it('keeps what Jellyfin reported last for the same stream, without live values', () => {
    const recover = createTranscodingInfoRecovery();
    recover([{ ...browser, TranscodingInfo: { ...info, Framerate: 90, CompletionPercentage: 40 } }]);
    const { sessions, origins } = recover([browser]);
    const stream = buildSessionsResponse(sessions, new Date(), null, new Map(), origins).sessions[0]!;
    expect(stream.transcoding).toMatchObject({ origin: 'lastKnown', reasons: ['VideoCodecNotSupported', 'AudioCodecNotSupported'], framerate: null, completionPercentage: null });
    // Another episode on the same session starts from scratch.
    const next = recover([{ ...browser, NowPlayingItem: { ...browser.NowPlayingItem, Id: 'episode2' } }]);
    expect(next.sessions[0]!.TranscodingInfo).toBeUndefined();
  });

  it('falls back to the FFmpeg log for what is converted', () => {
    expect(transcodedMediaSources([browser])).toEqual(['ms1']);
    const log: TranscodeLogInfo = {
      fileName: 'FFmpeg.Transcode-2026-10-26_21-00-00_ms1_12345678.log',
      startedAt: '2026-10-26T21:00:00',
      encoder: 'libx264',
      encoderHardware: false,
      decoder: null,
      decoderHardware: false,
      toneMapping: null,
      audioEncoder: 'aac',
      audioChannels: 2,
      container: 'ts',
      errors: [],
    };
    const stream = buildSessionsResponse([browser], new Date(), null, new Map([['ms1', log]])).sessions[0]!;
    expect(stream.playback.method).toBe('Transcode');
    expect(stream.transcoding).toMatchObject({ origin: 'log', videoCodec: 'h264', audioCodec: 'aac', audioChannels: 2, isVideoDirect: false, reasons: [], hardwareAcceleration: null });
    expect(stream.transcodeLog?.encoder).toBe('libx264');
  });
});
