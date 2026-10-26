import { describe, expect, it } from 'vitest';
import { describeSchedule, restricts } from './schedule';

describe('describeSchedule', () => {
  it('names window and idle rule', () => {
    expect(describeSchedule({ window: { start: '01:00', end: '06:00' }, idleOnly: true })).toBe('zwischen 01:00 und 06:00, wenn niemand streamt');
    expect(describeSchedule({ window: null, idleOnly: true })).toBe('wenn niemand streamt');
    expect(describeSchedule({ window: { start: '22:30', end: '05:00' }, idleOnly: false })).toBe('zwischen 22:30 und 05:00');
  });

  it('has nothing to say without restrictions', () => {
    expect(describeSchedule({ window: null, idleOnly: false })).toBeNull();
    expect(restricts({ window: null, idleOnly: false })).toBe(false);
  });
});
