import { describe, expect, it } from 'vitest';
import { createGate, inWindow, type AgentSettings } from '../src/schedule.js';

const at = (hours: number, minutes = 0) => new Date(2026, 9, 26, hours, minutes);

describe('inWindow', () => {
  it('handles windows within a day and across midnight', () => {
    const night = { start: '22:00', end: '06:00' };
    expect([at(21, 59), at(22), at(23, 30), at(5, 59), at(6)].map((date) => inWindow(date, night))).toEqual([false, true, true, true, false]);
    const morning = { start: '03:15', end: '07:00' };
    expect([at(3, 14), at(3, 15), at(6, 59), at(7)].map((date) => inWindow(date, morning))).toEqual([false, true, true, false]);
  });
});

describe('gate', () => {
  it('waits a few minutes after the last stream before it opens', async () => {
    let streams = 1;
    let clock = at(2);
    const settings: AgentSettings = { schedule: { window: null, idleOnly: true }, jellyfin: { url: 'http://jellyfin:8096', apiKey: 'key' }, network: [] };
    const gate = createGate({
      settings: () => settings,
      fetch: async () => Response.json(Array.from({ length: streams }, () => ({ NowPlayingItem: {} }))),
      now: () => clock,
    });
    expect(await gate(true)).toMatchObject({ open: false, pause: true, streams: 1 });
    streams = 0;
    clock = at(2, 3);
    expect(await gate(false)).toMatchObject({ open: false, pause: false, reason: 'Der letzte Stream endete eben erst – wartet noch ein paar Minuten.' });
    clock = at(2, 6);
    expect(await gate(false)).toMatchObject({ open: true, reason: null });
  });

  it('needs no Jellyfin without the idle rule', async () => {
    const settings: AgentSettings = { schedule: { window: { start: '01:00', end: '05:00' }, idleOnly: false }, jellyfin: null, network: [] };
    const gate = createGate({ settings: () => settings, fetch: async () => Promise.reject(new Error('no call expected')), now: () => at(3) });
    expect(await gate(false)).toMatchObject({ open: true, streams: null });
  });
});
