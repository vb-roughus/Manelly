import { describe, expect, it } from 'vitest';
import { activeFilterCount, describeAudioFilter, describeVideoFilter, hasAudioCondition, readFilters, toSearchParams } from './media';

describe('media filters in the URL', () => {
  it('round-trips filters through query parameters', () => {
    const filters = {
      q: 'dune',
      type: 'Movie' as const,
      genre: ['Action', 'Science Fiction'],
      yearFrom: 2010,
      audioLanguage: ['de'],
      audioFormat: ['atmos' as const],
      audioMinChannels: 8,
      audioCoverage: 'all' as const,
      sort: 'rating' as const,
      order: 'desc' as const,
    };
    expect(readFilters(toSearchParams(filters))).toEqual(filters);
  });

  it('drops malformed and default values', () => {
    const search = new URLSearchParams('type=Album&yearFrom=abc&minRating=&audioMode=has&audioCoverage=any&sort=random&genre=');
    expect(readFilters(search)).toEqual({});
  });

  it('leaves empty values out of the query', () => {
    expect(toSearchParams({ q: '', genre: [], type: undefined, offset: 0, limit: 60 }).toString()).toBe('offset=0&limit=60');
  });

  it('knows when an audio condition is set and counts active filters', () => {
    expect(hasAudioCondition({ audioMode: 'lacks' })).toBe(false);
    expect(hasAudioCondition({ audioLanguage: ['de'] })).toBe(true);
    expect(activeFilterCount({ q: 'x', type: 'Series', genre: ['Drama'], audioLanguage: ['de'], audioFormat: ['atmos'], yearTo: 2000 })).toBe(4);
  });

  it('summarizes the audio and video filters for collapsed panels', () => {
    expect(describeAudioFilter({ audioLanguage: ['de'], audioFormat: ['atmos'] })).toBe('Deutsch · Dolby Atmos');
    expect(describeAudioFilter({ audioLanguage: ['de'], audioMode: 'lacks' })).toBe('ohne Deutsch');
    expect(describeAudioFilter({ audioFormat: ['truehd', 'dts-hd-ma'], audioMinChannels: 8, audioCoverage: 'all' })).toBe(
      'Dolby TrueHD / DTS-HD MA · mind. 7.1 · alle Folgen',
    );
    expect(describeAudioFilter({ audioMode: 'lacks' })).toBeNull();
    expect(describeVideoFilter({ resolution: ['4K'], dynamicRange: ['DV', 'HDR10'] })).toBe('4K · Dolby Vision · HDR10');
    expect(describeVideoFilter({})).toBeNull();
  });
});
