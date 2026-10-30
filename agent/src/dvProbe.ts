import { execFile } from 'node:child_process';
import type { DolbyVisionInfo } from '@manelly/shared';

/** Results remembered at most; the oldest go first. */
const KEEP = 5000;
const TIMEOUT_MS = 20_000;

/** Runs ffprobe and answers what it printed. */
export type ProbeRunner = (tool: string, args: string[]) => Promise<string>;

const runFfprobe: ProbeRunner = (tool, args) =>
  new Promise((resolve, reject) => {
    execFile(tool, args, { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });

/** Reads the Dolby Vision configuration of the first video stream from ffprobe's JSON; null without Dolby Vision. */
export function parseDolbyVision(json: string): DolbyVisionInfo | null {
  const data = JSON.parse(json) as {
    streams?: Array<{ side_data_list?: Array<{ dv_profile?: number; dv_bl_signal_compatibility_id?: number; el_present_flag?: number }> }>;
  };
  const side = data.streams?.[0]?.side_data_list?.find((entry) => typeof entry.dv_profile === 'number');
  if (!side) return null;
  return { profile: side.dv_profile!, compatibility: side.dv_bl_signal_compatibility_id ?? null, enhancementLayer: side.el_present_flag === 1 };
}

/**
 * Which Dolby Vision a video file carries, read from its header – a few megabytes, not the whole file. Remembered by
 * path, size and time, so each file is read once; undefined when it cannot be read (no ffprobe, a broken file).
 */
export function createDolbyVisionProbe(ffprobe: () => Promise<string | null>, run: ProbeRunner = runFfprobe) {
  const known = new Map<string, { key: string; result: DolbyVisionInfo | null }>();
  return async (file: string, info: { size: number; mtimeMs: number }): Promise<DolbyVisionInfo | null | undefined> => {
    const key = `${info.size}:${info.mtimeMs}`;
    const hit = known.get(file);
    if (hit?.key === key) return hit.result;
    const tool = await ffprobe();
    if (!tool) return undefined;
    let result: DolbyVisionInfo | null;
    try {
      const args = ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream_side_data=dv_profile,dv_bl_signal_compatibility_id,el_present_flag', '-of', 'json', file];
      result = parseDolbyVision(await run(tool, args));
    } catch {
      return undefined;
    }
    known.delete(file);
    known.set(file, { key, result });
    if (known.size > KEEP) known.delete(known.keys().next().value!);
    return result;
  };
}

export type DolbyVisionProbe = ReturnType<typeof createDolbyVisionProbe>;
