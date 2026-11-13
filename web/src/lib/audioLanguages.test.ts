import { describe, expect, it } from 'vitest';
import { audioLanguageAdjective, audioLanguageLabel, needsPreferredAudio } from './audioLanguages';

const track = (language: string | null, isDefault = false) => ({ language, isDefault });

describe('preferred audio track', () => {
  it('names the languages', () => {
    expect([audioLanguageLabel('ger'), audioLanguageAdjective('ger'), audioLanguageLabel('xyz')]).toEqual(['Deutsch', 'deutsche', 'xyz']);
  });

  it('knows when the agent would change something', () => {
    // As MakeMKV writes it: English first and default.
    expect(needsPreferredAudio([track('en', true), track('de')], 'ger', false)).toBe(true);
    // German default, but second: only with «first».
    expect(needsPreferredAudio([track('en'), track('de', true)], 'ger', false)).toBe(false);
    expect(needsPreferredAudio([track('en'), track('de', true)], 'ger', true)).toBe(true);
    // Two defaults.
    expect(needsPreferredAudio([track('de', true), track('en', true)], 'ger', true)).toBe(true);
    expect(needsPreferredAudio([track('de-CH', true), track('en')], 'ger', true)).toBe(false);
    // No German track: nothing to do.
    expect(needsPreferredAudio([track('en', true), track(null)], 'ger', true)).toBe(false);
  });
});
