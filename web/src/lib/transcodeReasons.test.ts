import { describe, expect, it } from 'vitest';
import type { StreamSession, TranscodingDetails } from '@manelly/shared';
import { describeVideo } from './format';
import { explainAudioConversion, explainReason } from './transcodeReasons';

const transcoding: TranscodingDetails = {
  container: 'ts',
  videoCodec: 'hevc',
  audioCodec: 'aac',
  isVideoDirect: true,
  isAudioDirect: false,
  width: 3840,
  height: 2160,
  framerate: null,
  audioChannels: 6,
  bitrate: 59_200_000,
  completionPercentage: null,
  hardwareAcceleration: null,
  reasons: ['VideoRangeTypeNotSupported'],
};

/** A UHD Blu-ray remux with Dolby Vision profile 7 and TrueHD 7.1, played on an Android TV device. */
const session = {
  client: 'Jellyfin Android TV',
  source: {
    container: 'mkv',
    video: {
      codec: 'hevc',
      profile: 'Main 10',
      width: 3840,
      height: 2160,
      bitDepth: 10,
      frameRate: 23.976,
      bitrate: 55_000_000,
      videoRange: 'HDR',
      videoRangeType: 'DOVIWithEL',
      dvProfile: 7,
      level: 153,
      codecTag: 'dvhe',
      isInterlaced: false,
      refFrames: 1,
      displayTitle: null,
    },
    audio: {
      codec: 'truehd',
      profile: 'Dolby TrueHD + Dolby Atmos',
      channels: 8,
      channelLayout: '7.1',
      language: 'ger',
      bitrate: 4_000_000,
      sampleRate: 48_000,
      bitDepth: 24,
      displayTitle: null,
    },
    subtitle: null,
  },
  transcoding,
} as unknown as StreamSession;

describe('transcode reason details', () => {
  it('names the HDR format the client rejects and what Jellyfin does instead', () => {
    const details = explainReason('VideoRangeTypeNotSupported', session);
    expect(details.label).toBe('HDR-Format nicht unterstützt');
    expect(details.facts).toBe('Dolby Vision Profil 7 mit Enhancement Layer (DOVIWithEL)');
    expect(details.outcome).toContain('entfernt deshalb die Dolby-Vision-Daten und schickt die HDR10-Basis');
    expect(details.tip).toContain('Profil 8.1');
    expect(describeVideo(session.source.video!)).toBe('4K · HEVC · Dolby Vision P7');
  });

  it('shows the concrete value for other reasons', () => {
    expect(explainReason('VideoLevelNotSupported', session).facts).toBe('Level 5.1');
    expect(explainReason('AudioCodecNotSupported', session).facts).toBe('Tonspur TrueHD (Dolby TrueHD + Dolby Atmos)');
    expect(explainReason('ContainerBitrateExceedsLimit', session)).toMatchObject({
      facts: 'Bitrate 59.0 Mbit/s',
      outcome: 'Jellyfin schickt deshalb 59.2 Mbit/s.',
    });
    expect(explainReason('AudioIsExternal', session).facts).toBeNull();
  });

  it('explains audio that is converted without a reason of its own', () => {
    const audio = explainAudioConversion(session);
    expect(audio?.label).toBe('Warum TrueHD 7.1 → AAC 5.1?');
    expect(audio?.explanation).toContain('in einen Streaming-Container (TS) um, und darin nimmt der Client TrueHD nicht an');
    expect(audio?.outcome).toContain('Statt 7.1 gibt es 5.1');
    expect(audio?.tip).toContain('Jellyfin Android TV');

    // An audio reason explains it already; copied audio needs no explanation.
    expect(explainAudioConversion({ ...session, transcoding: { ...transcoding, reasons: ['AudioCodecNotSupported'] } })).toBeNull();
    expect(explainAudioConversion({ ...session, transcoding: { ...transcoding, isAudioDirect: true } })).toBeNull();
  });
});
