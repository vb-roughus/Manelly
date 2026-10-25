import { describe, expect, it } from 'vitest';
import type { StreamSession } from '@manelly/shared';
import { describeFinding, formatAhead } from './streamFindings';

const session = { user: { id: 'u1', name: 'Anna', imageTag: null } } as StreamSession;

describe('stream findings', () => {
  it('formats the buffer ahead of playback', () => {
    expect(formatAhead(8_000)).toBe('8 s');
    expect(formatAhead(600_000)).toBe('10 min');
    expect(formatAhead(4_500_000)).toBe('1 h 15 min');
  });

  it('describes the transcoder speed', () => {
    const throughput = { kind: 'throughput', speed: 2.5, transcodeFps: 60, sourceFps: 23.976, bufferAheadMs: 600_000 } as const;
    expect(describeFinding({ ...throughput, severity: 'good' }, session)).toEqual({
      title: 'Transcoding hält mit',
      detail: '2.5× Echtzeit (60 von 24 nötigen Bildern/s), 10 min Vorlauf.',
      action: null,
    });
    const slow = describeFinding({ ...throughput, speed: 0.75, transcodeFps: 18, bufferAheadMs: 6_000, severity: 'critical' }, session);
    expect(slow.title).toBe('Server kommt nicht nach');
    expect(slow.detail).toBe('Der Server schafft nur 0.8× Echtzeit (18 von 24 nötigen Bildern/s), Vorlauf 6 s. Die Wiedergabe stockt oder puffert.');
  });

  it('names the setting to change', () => {
    const decoding = describeFinding(
      { kind: 'softwareDecoding', severity: 'warning', hardware: 'qsv', codec: 'hevc', bitDepth: 10, cause: 'tenBitDisabled' },
      session,
    );
    expect(decoding.title).toBe('HEVC 10 bit wird in Software dekodiert');
    expect(decoding.detail).toContain('Intel Quick Sync ist eingerichtet');
    expect(decoding.action).toContain('«HEVC 10 bit» einschalten');

    const limit = describeFinding({ kind: 'bitrateLimit', severity: 'info', limitedBy: 'user', limit: 4_000_000, sourceBitrate: 30_640_000 }, session);
    expect(limit.detail).toBe('Für Anna gilt ausserhalb des Heimnetzes ein Limit von 4.0 Mbit/s (Datei: 30.6 Mbit/s) – deshalb wird transcodiert.');
  });
});
