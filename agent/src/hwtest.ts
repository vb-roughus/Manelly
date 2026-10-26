import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { HardwareTestId, HardwareTestRequest, HardwareTestResult } from '@manelly/shared';
import { AgentError } from './errors.js';
import { parseVersion } from './tools.js';

const TEST_TIMEOUT_MS = 60_000;
// A short synthetic picture; nothing is read from or written to the media folders.
const TEST_SOURCE = ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25:duration=2'];
const KNOWN_HARDWARE = new Set(['qsv', 'nvenc', 'amf', 'vaapi', 'videotoolbox', 'v4l2m2m', 'rkmpp']);

interface Run {
  code: number | null;
  output: string;
}

function ffmpeg(file: string, args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: TEST_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : null) : 0;
      resolve({ code, output: `${stdout}${stderr}`.trim() });
    });
  });
}

/** How the hardware encoder of each acceleration takes ordinary frames, as Jellyfin's FFmpeg expects them. */
function encodeArgs(hardware: string, codec: 'h264' | 'hevc', vaapiDevice: string): string[] {
  const encoder = `${codec}_${hardware}`;
  switch (hardware) {
    case 'vaapi':
      return ['-vaapi_device', vaapiDevice, '-vf', 'format=nv12,hwupload', '-c:v', encoder];
    case 'nvenc':
      return ['-pix_fmt', 'yuv420p', '-c:v', encoder];
    case 'videotoolbox':
      return ['-c:v', encoder];
    default:
      return ['-pix_fmt', 'nv12', '-c:v', encoder];
  }
}

/** The hardware decoder Jellyfin uses with each acceleration (on Windows QSV and AMF decode through D3D11VA). */
function decodeArgs(hardware: string, vaapiDevice: string, platform: NodeJS.Platform): string[] | null {
  switch (hardware) {
    case 'qsv':
      return platform === 'win32' ? ['-hwaccel', 'd3d11va'] : ['-hwaccel', 'vaapi', '-hwaccel_device', vaapiDevice];
    case 'amf':
      return ['-hwaccel', 'd3d11va'];
    case 'nvenc':
      return ['-hwaccel', 'cuda'];
    case 'vaapi':
      return ['-hwaccel', 'vaapi', '-hwaccel_device', vaapiDevice];
    case 'videotoolbox':
      return ['-hwaccel', 'videotoolbox'];
    case 'rkmpp':
      return ['-hwaccel', 'rkmpp'];
    default:
      return null;
  }
}

const SAMPLES: Record<'decode-h264' | 'decode-hevc' | 'decode-hevc10', string[]> = {
  'decode-h264': ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'],
  'decode-hevc': ['-c:v', 'libx265', '-pix_fmt', 'yuv420p', '-x265-params', 'log-level=error'],
  'decode-hevc10': ['-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-x265-params', 'log-level=error'],
};

// FFmpeg falls back to software decoding with just a warning; these lines give it away.
const DECODE_FAILURE = /Failed setup for format|hwaccel initialisation returned error|Failed to create|Device creation failed|Cannot load/i;

const lastLines = (output: string) => output.split(/\r?\n/).filter(Boolean).slice(-15).join('\n') || null;

/**
 * Lets Jellyfin's FFmpeg encode and decode a few seconds of a test picture
 * with the configured hardware – the most direct way to see whether it works.
 */
export async function runHardwareTest(request: HardwareTestRequest, ffmpegPath: string | null, platform: NodeJS.Platform = process.platform): Promise<HardwareTestResult> {
  if (!KNOWN_HARDWARE.has(request.hardware)) throw new AgentError(400, `Unbekannte Hardware-Beschleunigung «${request.hardware}».`);
  if (!ffmpegPath) throw new AgentError(503, 'Der Agent findet kein FFmpeg.');
  const version = parseVersion((await ffmpeg(ffmpegPath, ['-version'])).output);
  const vaapiDevice = request.vaapiDevice || '/dev/dri/renderD128';
  const base = ['-hide_banner', '-nostdin', '-y'];
  const result: HardwareTestResult = { hardware: request.hardware, ffmpeg: { path: ffmpegPath, version }, tests: [] };
  const temp = await mkdtemp(path.join(tmpdir(), 'manelly-hwtest-'));

  try {
    for (const id of request.tests) {
      const started = Date.now();
      const done = (fields: Omit<HardwareTestResult['tests'][number], 'id' | 'durationMs'>) =>
        result.tests.push({ id, durationMs: Date.now() - started, ...fields });

      if (id === 'encode-h264' || id === 'encode-hevc') {
        const run = await ffmpeg(ffmpegPath, [...base, '-v', 'error', ...TEST_SOURCE, ...encodeArgs(request.hardware, id === 'encode-h264' ? 'h264' : 'hevc', vaapiDevice), '-f', 'null', '-']);
        done(run.code === 0 ? { ok: true, skipped: false, message: null, log: null } : { ok: false, skipped: false, message: `FFmpeg ist fehlgeschlagen (Exit-Code ${run.code ?? '–'}).`, log: lastLines(run.output) });
        continue;
      }

      const hwaccel = decodeArgs(request.hardware, vaapiDevice, platform);
      if (!hwaccel) {
        done({ ok: false, skipped: true, message: 'Für diese Beschleunigung prüft Manelly das Dekodieren nicht.', log: null });
        continue;
      }
      // A test video made in software, then decoded on the hardware.
      const sample = path.join(temp, `${id}.mkv`);
      const made = await ffmpeg(ffmpegPath, [...base, '-v', 'error', ...TEST_SOURCE, ...SAMPLES[id], sample]);
      if (made.code !== 0) {
        done({ ok: false, skipped: true, message: 'Das Testvideo liess sich nicht erzeugen (fehlt libx264/libx265 in diesem FFmpeg?).', log: lastLines(made.output) });
        continue;
      }
      const run = await ffmpeg(ffmpegPath, [...base, '-v', 'warning', ...hwaccel, '-i', sample, '-f', 'null', '-']);
      const failed = run.code !== 0 || DECODE_FAILURE.test(run.output);
      done(failed ? { ok: false, skipped: false, message: 'Die Grafikeinheit hat nicht dekodiert; FFmpeg ist auf Software ausgewichen oder abgebrochen.', log: lastLines(run.output) } : { ok: true, skipped: false, message: null, log: null });
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  return result;
}

export const HARDWARE_TESTS: HardwareTestId[] = ['encode-h264', 'encode-hevc', 'decode-h264', 'decode-hevc', 'decode-hevc10'];
