import { describe, expect, it } from 'vitest';
import type { JellyfinClient } from '../src/jellyfin/client.js';
import { createTranscodeLogReader, parseLogName, parseTranscodeLog } from '../src/transcodeLog.js';

/** How Jellyfin starts a transcode log: media source JSON, a blank line, the command line, then FFmpeg's output. */
const log = (command: string, output: string[] = []) =>
  ['{"Protocol":"File","Id":"6a3f0c2e","Path":"D:\\\\Filme\\\\Film.mkv"}', '', command, '', 'ffmpeg version 7.0.2-Jellyfin', ...output].join('\r\n');

const QSV_WINDOWS =
  'C:\\Program Files\\Jellyfin\\Server\\ffmpeg.exe -analyzeduration 200M -probesize 1G -init_hw_device d3d11va=dx11:,vendor=0x8086 ' +
  '-init_hw_device qsv=qs@dx11 -filter_hw_device qs -hwaccel d3d11va -hwaccel_output_format d3d11 -noautorotate ' +
  '-i file:"D:\\Filme\\Pitch Black (2000)\\Pitch Black (2000).mkv" -map_metadata -1 -map 0:0 -map 0:1 -codec:v:0 h264_qsv -preset veryfast ' +
  '-b:v 9616000 -filter_complex "[0:0]setparams=color_trc=smpte2084,scale_d3d11=format=nv12,hwmap=derive_device=qsv,format=qsv,vpp_qsv=w=1920:h=800:format=nv12:tonemap=1[main]" ' +
  '-codec:a:0 aac -ac 6 -f hls -hls_time 6';

const SOFTWARE =
  '/usr/lib/jellyfin-ffmpeg/ffmpeg -analyzeduration 200M -probesize 1G -i file:"/media/filme/Film.mkv" -map 0:0 -map 0:1 ' +
  '-codec:v:0 libx264 -preset veryfast -crf 23 -vf "setparams=color_trc=smpte2084,tonemapx=tonemap=bt2390:t=bt709:format=yuv420p" -codec:a:0 copy -f hls';

describe('FFmpeg transcode logs', () => {
  it('reads the media source id from the file name', () => {
    expect(parseLogName('FFmpeg.Transcode-2026-10-26_20-31-05_6a3f0c2e9b1d4e8f_1a2b3c4d.log')).toEqual({
      kind: 'Transcode',
      startedAt: '2026-10-26T20:31:05',
      mediaSourceId: '6a3f0c2e9b1d4e8f',
    });
    expect(parseLogName('log_20261026.log')).toBeNull();
  });

  it('recognizes a transcode running on Intel Quick Sync', () => {
    expect(parseTranscodeLog(log(QSV_WINDOWS))).toEqual({
      encoder: 'h264_qsv',
      encoderHardware: true,
      decoder: 'hwaccel d3d11va',
      decoderHardware: true,
      toneMapping: 'hardware',
      audioEncoder: 'aac',
      audioChannels: 6,
      container: 'ts',
      errors: [],
    });
  });

  it('recognizes software decoding, encoding and tone mapping', () => {
    expect(parseTranscodeLog(log(SOFTWARE))).toMatchObject({
      encoder: 'libx264',
      encoderHardware: false,
      decoder: null,
      decoderHardware: false,
      toneMapping: 'software',
      audioEncoder: 'copy',
      audioChannels: null,
      container: 'ts',
    });
  });

  it('notices when the hardware decoder failed and FFmpeg fell back to software', () => {
    const parsed = parseTranscodeLog(log(QSV_WINDOWS, ['[hevc @ 000001] Failed setup for format d3d11: hwaccel initialisation returned error.', 'frame=  100 fps= 20']));
    expect(parsed.decoderHardware).toBe(false);
    expect(parsed.errors).toEqual(['[hevc @ 000001] Failed setup for format d3d11: hwaccel initialisation returned error.']);
    expect(parseTranscodeLog(log(QSV_WINDOWS, ['[h264_qsv @ 0001] Error creating a MFX session: -9.', 'Conversion failed!'])).errors).toHaveLength(2);
  });

  it('reads only the start of the newest log of a media source, once', async () => {
    let reads = 0;
    const client = {
      getLogFiles: async () => [
        { Name: 'FFmpeg.Transcode-2026-10-26_20-00-00_6a3f0c2e9b1d4e8f_aaaaaaaa.log' },
        { Name: 'FFmpeg.Transcode-2026-10-26_21-00-00_6a3f0c2e9b1d4e8f_bbbbbbbb.log' },
        { Name: 'FFmpeg.Remux-2026-10-26_22-00-00_6a3f0c2e9b1d4e8f_cccccccc.log' },
        { Name: 'log_20261026.log' },
      ],
      getLogFile: async (name: string) => {
        reads += 1;
        // A large log: the reader must stop after the start.
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(log(name.includes('21-00') ? QSV_WINDOWS : SOFTWARE)));
            for (let i = 0; i < 100; i++) controller.enqueue(new TextEncoder().encode('frame= 1 fps=24 q=-0.0 size=1kB time=00:00:01.00 bitrate=1kbits/s\n'.repeat(500)));
            controller.close();
          },
        });
        return new Response(body);
      },
    } as unknown as JellyfinClient;
    const reader = createTranscodeLogReader();

    const logs = await reader.forMediaSources(client, ['6A3F0C2E-9B1D-4E8F']);
    expect(logs.get('6a3f0c2e9b1d4e8f')).toMatchObject({ fileName: 'FFmpeg.Transcode-2026-10-26_21-00-00_6a3f0c2e9b1d4e8f_bbbbbbbb.log', encoder: 'h264_qsv' });
    await reader.forMediaSources(client, ['6a3f0c2e9b1d4e8f']);
    expect(reads).toBe(1);
    expect((await reader.recent(client, 5)).map((entry) => entry.encoder)).toEqual(['h264_qsv', 'libx264']);
  });
});
