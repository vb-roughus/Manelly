import { describe, expect, it } from 'vitest';
import { channelsText, layoutOf, suggested, trackFormat, trackLanguage } from './tracks';

describe('tracks to pick', () => {
  it('names channels, languages and formats', () => {
    expect([1, 2, 6, 8, 12, null].map(channelsText)).toEqual(['Mono', 'Stereo', '5.1', '7.1', '12 Kanäle', null]);
    expect(channelsText('5.1(side)')).toBe('5.1');
    expect(trackLanguage({ language: 'ger' })).toBe('Deutsch');
    expect(trackLanguage({ language: 'deu' })).toBe('Deutsch');
    expect(trackLanguage({ language: null, languageName: null })).toBe('ohne Sprache');
    expect(trackFormat({ codec: 'DTS-HD Master Audio', channels: 6 })).toBe('DTS-HD Master Audio 5.1');
  });

  it('groups the same tracks, and takes the suggestion', () => {
    const episode = [
      { language: 'ger', codec: 'AC3', channels: '5.1(side)', keep: true },
      { language: 'eng', codec: 'AC3', channels: 'stereo', keep: false },
    ];
    expect(layoutOf(episode, [])).toBe(layoutOf([...episode], []));
    expect(layoutOf(episode, [])).not.toBe(layoutOf([episode[1]!, episode[0]!], []));
    expect([...suggested(episode)]).toEqual([0]);
  });
});
