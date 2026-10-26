import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runHardwareTest } from '../src/hwtest.js';

let dir: string;

/** A stand-in FFmpeg: hardware encoders and decoding work unless the environment says otherwise. */
async function fakeFfmpeg(): Promise<string> {
  const file = path.join(dir, 'ffmpeg');
  await writeFile(
    file,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '-version') { console.log('ffmpeg version 7.0.2-Jellyfin Copyright'); process.exit(0); }
const codec = args[args.lastIndexOf('-c:v') + 1] || '';
if (args.includes('-hwaccel')) {
  if (process.env.FAKE_DECODE_FALLBACK) console.error('[hevc @ 0x1] Failed setup for format d3d11: hwaccel initialisation returned error.');
  process.exit(0);
}
if (codec.startsWith('lib')) { fs.writeFileSync(args[args.length - 1], 'video'); process.exit(0); }
if (process.env.FAKE_ENCODE_FAIL) { console.error('[h264_qsv @ 0x1] Error creating a MFX session: -9.'); process.exit(1); }
process.exit(0);
`,
  );
  await chmod(file, 0o755);
  return file;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'manelly-hwtest-test-'));
  delete process.env.FAKE_DECODE_FALLBACK;
  delete process.env.FAKE_ENCODE_FAIL;
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('hardware test', () => {
  it('reports working hardware', async () => {
    const result = await runHardwareTest({ hardware: 'qsv', tests: ['encode-h264', 'decode-hevc10'] }, await fakeFfmpeg(), 'win32');
    expect(result.ffmpeg.version).toBe('7.0.2-Jellyfin');
    expect(result.tests.map((entry) => [entry.id, entry.ok])).toEqual([
      ['encode-h264', true],
      ['decode-hevc10', true],
    ]);
  });

  it('shows what FFmpeg said when the hardware fails', async () => {
    process.env.FAKE_ENCODE_FAIL = '1';
    process.env.FAKE_DECODE_FALLBACK = '1';
    const result = await runHardwareTest({ hardware: 'qsv', tests: ['encode-h264', 'decode-h264'] }, await fakeFfmpeg(), 'win32');
    expect(result.tests[0]).toMatchObject({ ok: false, skipped: false, log: '[h264_qsv @ 0x1] Error creating a MFX session: -9.' });
    // FFmpeg falls back to software with only a warning – still a failed test.
    expect(result.tests[1]).toMatchObject({ ok: false, message: expect.stringContaining('nicht dekodiert') });
  });

  it('refuses unknown accelerations', async () => {
    await expect(runHardwareTest({ hardware: 'magic', tests: ['encode-h264'] }, await fakeFfmpeg())).rejects.toThrow('Unbekannte');
  });
});
