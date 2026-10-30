import { describe, expect, it } from 'vitest';
import { createDolbyVisionProbe, parseDolbyVision } from '../src/dvProbe.js';

const output = (side: unknown[]) => JSON.stringify({ programs: [], streams: [{ side_data_list: side }] });

describe('Dolby Vision probe', () => {
  it('reads profile, compatibility and the enhancement layer', () => {
    expect(parseDolbyVision(output([{ side_data_type: 'DOVI configuration record', dv_profile: 7, dv_bl_signal_compatibility_id: 6, el_present_flag: 1 }]))).toEqual({
      profile: 7,
      compatibility: 6,
      enhancementLayer: true,
    });
    expect(parseDolbyVision(output([{ side_data_type: 'Mastering display metadata' }, { dv_profile: 8, dv_bl_signal_compatibility_id: 1, el_present_flag: 0 }]))).toEqual({
      profile: 8,
      compatibility: 1,
      enhancementLayer: false,
    });
    expect(parseDolbyVision(output([{ dv_profile: 5 }]))).toEqual({ profile: 5, compatibility: null, enhancementLayer: false });
    expect(parseDolbyVision(output([]))).toBeNull();
    expect(parseDolbyVision(JSON.stringify({ streams: [] }))).toBeNull();
    expect(parseDolbyVision('{}')).toBeNull();
  });

  it('reads each file once until it changes, and knows nothing without ffprobe or when it fails', async () => {
    const calls: string[] = [];
    let fail = false;
    const probe = createDolbyVisionProbe(
      async () => '/bin/ffprobe',
      async (tool, args) => {
        calls.push(`${tool} ${args[args.length - 1]}`);
        if (fail) throw new Error('Invalid data found when processing input');
        return output([{ dv_profile: 7, el_present_flag: 1 }]);
      },
    );
    const info = { size: 100, mtimeMs: 1 };
    expect(await probe('/x/a.mkv', info)).toEqual({ profile: 7, compatibility: null, enhancementLayer: true });
    expect(await probe('/x/a.mkv', info)).toEqual({ profile: 7, compatibility: null, enhancementLayer: true });
    expect(calls).toEqual(['/bin/ffprobe /x/a.mkv']);
    // Still being extracted: it grew, so it is read again.
    await probe('/x/a.mkv', { size: 200, mtimeMs: 2 });
    expect(calls).toHaveLength(2);
    fail = true;
    expect(await probe('/x/b.mkv', info)).toBeUndefined();
    // A failure is not remembered.
    fail = false;
    expect(await probe('/x/b.mkv', info)).not.toBeUndefined();
    expect(calls).toHaveLength(4);

    const without = createDolbyVisionProbe(
      async () => null,
      async () => {
        throw new Error('not called');
      },
    );
    expect(await without('/x/a.mkv', info)).toBeUndefined();
  });
});
