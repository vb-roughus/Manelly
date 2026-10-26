import { describe, expect, it } from 'vitest';
import type { TranscodeLogInfo } from '@manelly/shared';
import type { JellyfinClient } from '../src/jellyfin/client.js';
import { checkTranscoding, hardwareTestRequest } from '../src/transcodingReport.js';

const qsv = { HardwareAccelerationType: 'qsv', EnableHardwareEncoding: true, HardwareDecodingCodecs: ['h264', 'hevc', 'vc1'], EnableDecodingColorDepth10Hevc: true, EnableTonemapping: true };
const log = (overrides: Partial<TranscodeLogInfo> = {}): TranscodeLogInfo => ({
  fileName: 'FFmpeg.Transcode-x.log',
  startedAt: '2026-10-26T21:00:00',
  encoder: 'h264_qsv',
  encoderHardware: true,
  decoder: 'hwaccel d3d11va',
  decoderHardware: true,
  toneMapping: null,
  errors: [],
  ...overrides,
});
const kinds = (checks: ReturnType<typeof checkTranscoding>) => checks.map((check) => check.kind);

describe('transcoding checks', () => {
  it('confirms a sound setup', () => {
    expect(checkTranscoding(qsv, 'windows', [log()])).toEqual([{ kind: 'ok', severity: 'good', hardware: 'qsv' }]);
  });

  it('finds what is switched off or does not fit the system', () => {
    // Jellyfin's defaults: only H.264 and VC-1 are decoded in hardware, no tone mapping.
    const defaults = { HardwareAccelerationType: 'vaapi', EnableHardwareEncoding: false, HardwareDecodingCodecs: ['h264', 'vc1'] };
    const checks = checkTranscoding(defaults, 'windows', []);
    expect(kinds(checks)).toEqual(['platformMismatch', 'encodingDisabled', 'decodingCodecsMissing', 'toneMappingDisabled']);
    expect(checks[2]).toMatchObject({ codecs: ['hevc'] });
    expect(kinds(checkTranscoding({ ...qsv, EnableDecodingColorDepth10Hevc: false }, 'windows', []))).toEqual(['hevc10BitDisabled']);
    expect(kinds(checkTranscoding({ HardwareAccelerationType: 'none' }, 'windows', []))).toEqual(['noAcceleration']);
  });

  it('counts recent transcodes in software or with FFmpeg errors', () => {
    const recent = [log(), log({ encoder: 'libx264', encoderHardware: false }), log({ errors: ['Error creating a MFX session: -9.'] })];
    expect(checkTranscoding(qsv, 'windows', recent)).toEqual([
      { kind: 'recentErrors', severity: 'warning', count: 1, total: 3 },
      { kind: 'recentSoftware', severity: 'warning', count: 1, total: 3 },
    ]);
  });

  it('tests what Jellyfin is set up to use the hardware for', async () => {
    const client = (encoding: object) => ({ getEncodingOptions: async () => encoding }) as unknown as JellyfinClient;
    expect(await hardwareTestRequest(client({ ...qsv, EncoderAppPath: 'C:\\Program Files\\Jellyfin\\Server\\ffmpeg.exe' }))).toEqual({
      hardware: 'qsv',
      ffmpegPath: 'C:\\Program Files\\Jellyfin\\Server\\ffmpeg.exe',
      vaapiDevice: null,
      tests: ['encode-h264', 'decode-h264', 'decode-hevc', 'decode-hevc10'],
    });
    expect((await hardwareTestRequest(client({ ...qsv, AllowHevcEncoding: true }))).tests).toContain('encode-hevc');
    await expect(hardwareTestRequest(client({ HardwareAccelerationType: 'none' }))).rejects.toThrow('keine Hardware-Beschleunigung');
  });
});
