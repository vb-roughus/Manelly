import type { HardwareTestId, HardwareTestRequest, TranscodeLogInfo, TranscodingCheck, TranscodingReport } from '@manelly/shared';
import type { JellyfinClient } from './jellyfin/client.js';
import type { JfEncodingOptions } from './jellyfin/types.js';
import { operatingSystemOf, PLATFORM_ACCELERATIONS, type OperatingSystem } from './streamHealth.js';
import type { TranscodeLogReader } from './transcodeLog.js';

const RECENT_LOGS = 10;
// Codecs most libraries are full of; the hardware should decode them.
const ESSENTIAL_DECODING = ['h264', 'hevc'];

function hardwareOf(encoding: JfEncodingOptions): string | null {
  const hardware = encoding.HardwareAccelerationType?.toLowerCase();
  return hardware && hardware !== 'none' ? hardware : null;
}

/** Checks Jellyfin's transcoding settings against the server's system and its latest transcodes. */
export function checkTranscoding(encoding: JfEncodingOptions, system: OperatingSystem | null, recent: TranscodeLogInfo[]): TranscodingCheck[] {
  const checks: TranscodingCheck[] = [];
  const hardware = hardwareOf(encoding);
  const decoding = (encoding.HardwareDecodingCodecs ?? []).map((codec) => codec.toLowerCase());

  if (!hardware) {
    checks.push({ kind: 'noAcceleration', severity: 'warning' });
  } else {
    if (system && !PLATFORM_ACCELERATIONS[system].includes(hardware)) {
      checks.push({ kind: 'platformMismatch', severity: 'critical', hardware, operatingSystem: system });
    }
    if (encoding.EnableHardwareEncoding === false) checks.push({ kind: 'encodingDisabled', severity: 'warning', hardware });
    const missing = ESSENTIAL_DECODING.filter((codec) => !decoding.includes(codec));
    if (missing.length) checks.push({ kind: 'decodingCodecsMissing', severity: 'warning', hardware, codecs: missing });
    if (decoding.includes('hevc') && encoding.EnableDecodingColorDepth10Hevc === false && hardware !== 'videotoolbox') {
      checks.push({ kind: 'hevc10BitDisabled', severity: 'warning', hardware });
    }
    if (!encoding.EnableTonemapping && !encoding.EnableVppTonemapping && !encoding.EnableVideoToolboxTonemapping) {
      checks.push({ kind: 'toneMappingDisabled', severity: 'info' });
    }
  }

  const withErrors = recent.filter((log) => log.errors.length > 0).length;
  if (withErrors) checks.push({ kind: 'recentErrors', severity: 'warning', count: withErrors, total: recent.length });
  if (hardware && encoding.EnableHardwareEncoding !== false) {
    const software = recent.filter((log) => log.encoderHardware === false).length;
    if (software) checks.push({ kind: 'recentSoftware', severity: 'warning', count: software, total: recent.length });
  }
  if (hardware && !checks.some((check) => check.severity === 'warning' || check.severity === 'critical')) {
    checks.unshift({ kind: 'ok', severity: 'good', hardware });
  }
  return checks;
}

export async function transcodingReport(client: JellyfinClient, logs: TranscodeLogReader): Promise<TranscodingReport> {
  const [encoding, system] = await Promise.all([client.getEncodingOptions(), client.getSystemInfo()]);
  let recent: TranscodeLogInfo[] = [];
  let logsReadable = true;
  try {
    recent = await logs.recent(client, RECENT_LOGS);
  } catch {
    logsReadable = false;
  }
  const operatingSystem = operatingSystemOf(system);
  return {
    operatingSystem,
    hardwareAcceleration: hardwareOf(encoding),
    hardwareEncoding: encoding.EnableHardwareEncoding !== false,
    hardwareDecodingCodecs: (encoding.HardwareDecodingCodecs ?? []).map((codec) => codec.toLowerCase()),
    hevc10Bit: encoding.EnableDecodingColorDepth10Hevc !== false,
    toneMapping: Boolean(encoding.EnableTonemapping || encoding.EnableVppTonemapping || encoding.EnableVideoToolboxTonemapping),
    allowHevcEncoding: encoding.AllowHevcEncoding === true,
    allowAv1Encoding: encoding.AllowAv1Encoding === true,
    encoderPath: encoding.EncoderAppPathDisplay || encoding.EncoderAppPath || null,
    checks: checkTranscoding(encoding, operatingSystem, recent),
    recent,
    logsReadable,
  };
}

/** What to test on the hardware: what Jellyfin is set up to use it for. */
export async function hardwareTestRequest(client: JellyfinClient): Promise<HardwareTestRequest> {
  const encoding = await client.getEncodingOptions();
  const hardware = hardwareOf(encoding);
  if (!hardware) throw new Error('In Jellyfin ist keine Hardware-Beschleunigung eingerichtet – es gibt nichts zu testen.');
  const decoding = (encoding.HardwareDecodingCodecs ?? []).map((codec) => codec.toLowerCase());
  const tests: HardwareTestId[] = ['encode-h264'];
  if (encoding.AllowHevcEncoding) tests.push('encode-hevc');
  if (decoding.includes('h264')) tests.push('decode-h264');
  if (decoding.includes('hevc')) {
    tests.push('decode-hevc');
    if (encoding.EnableDecodingColorDepth10Hevc !== false) tests.push('decode-hevc10');
  }
  return { hardware, ffmpegPath: encoding.EncoderAppPath || null, vaapiDevice: encoding.VaapiDevice || null, tests };
}
