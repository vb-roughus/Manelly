import { describe, expect, it } from 'vitest';
import { originalAge } from './originals';

const now = Date.parse('2026-10-28T12:00:00Z');
const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();

describe('originalAge', () => {
  it('marks originals kept longer than 30 days yellow and longer than 90 days red', () => {
    expect(originalAge(daysAgo(0), now)).toEqual({ days: 0, tone: 'fresh' });
    expect(originalAge(daysAgo(30), now)).toEqual({ days: 30, tone: 'fresh' });
    expect(originalAge(daysAgo(31), now)).toEqual({ days: 31, tone: 'old' });
    expect(originalAge(daysAgo(90), now)).toEqual({ days: 90, tone: 'old' });
    expect(originalAge(daysAgo(91), now)).toEqual({ days: 91, tone: 'stale' });
  });
});
