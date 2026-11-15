import { describe, expect, it } from 'vitest';
import type { DiscTitle } from '@manelly/shared';
import { fileNamesFor, formatDuration, isPlainName, languageName, librarySearchFor, makemkvAdvice, nameFromDisc, namesFromDisc, suggestSelection } from './discs';

const title = (index: number, minutes: number, bytes = minutes * 1e7): DiscTitle => ({ index, durationSeconds: Math.round(minutes * 60), chapters: 1, bytes, video: null, audio: [], subtitles: [] });

describe('advice after MakeMKV failed', () => {
  it('names a missing key, an old version and a crash – and nothing else', () => {
    const expired = 'Evaluation period has expired. Please purchase an activation key if you\'ve found this application useful.';
    expect(makemkvAdvice('MakeMKV fand im Image keine Titel: Using image file', [{ text: expired }])).toBe('key');
    expect(makemkvAdvice('MakeMKV ist fehlgeschlagen (Exit-Code 1): This application version is too old.')).toBe('version');
    // Agents before 0.40.2 give Windows' crash status as exit code; newer ones say so.
    expect(makemkvAdvice('MakeMKV ist fehlgeschlagen (Exit-Code 3221225477): AACS directory not present, assuming unencrypted disc')).toBe('crash');
    expect(makemkvAdvice('MakeMKV ist abgestürzt (Windows-Fehler 0xC0000005, Zugriffsverletzung): AACS directory not present')).toBe('crash');
    // The warning about decryption software alone says nothing about a key.
    expect(makemkvAdvice('MakeMKV ist fehlgeschlagen (Exit-Code 1): Failed to open disc', [{ text: 'It appears that you have on-the-fly decryption software enabled.' }])).toBeNull();
    expect(makemkvAdvice(null)).toBeNull();
  });
});

describe('discs', () => {
  it('takes the main film of a film disc', () => {
    expect(suggestSelection([title(0, 118.5), title(1, 12), title(2, 21), title(3, 20)])).toEqual({ kind: 'film', selected: [0] });
    expect(suggestSelection([])).toEqual({ kind: 'film', selected: [] });
  });

  it('takes the episodes of a series disc, without the "play all" title', () => {
    expect(suggestSelection([title(0, 88.6), title(1, 22.1), title(2, 22.0), title(3, 22.2), title(4, 22.3), title(5, 3)])).toEqual({ kind: 'serie', selected: [1, 2, 3, 4] });
    expect(suggestSelection([title(0, 44), title(1, 46), title(2, 45), title(3, 8)])).toEqual({ kind: 'serie', selected: [0, 1, 2] });
  });

  it('names things', () => {
    expect(nameFromDisc('FINDET_NEMO')).toBe('Findet Nemo');
    expect(nameFromDisc('Die Hard 2')).toBe('Die Hard 2');
    expect(namesFromDisc('BERGWACHT_S2_D1')).toEqual({ film: 'Bergwacht S2', series: 'Bergwacht', season: 2 });
    expect(namesFromDisc('HERR_DER_RINGE_DISC_1')).toEqual({ film: 'Herr Der Ringe', series: 'Herr Der Ringe', season: null });
    expect(namesFromDisc('FRIENDS_STAFFEL_10')).toMatchObject({ series: 'Friends', season: 10 });
    expect(librarySearchFor('Findet Nemo (2003)')).toBe('Findet Nemo');
    expect(librarySearchFor('Dark S1 D1')).toBe('Dark');
    expect(librarySearchFor('Friends Staffel 3 DVD 2')).toBe('Friends');
    expect([...fileNamesFor('film', 'Findet Nemo (2003)', [3, 0], 1, 1)]).toEqual([
      [0, 'Findet Nemo (2003).mkv'],
      [3, 'Findet Nemo (2003) - Titel 4.mkv'],
    ]);
    expect([...fileNamesFor('serie', 'Dark', [2, 1], 1, 5)]).toEqual([
      [1, 'Dark S01E05.mkv'],
      [2, 'Dark S01E06.mkv'],
    ]);
    expect([isPlainName('Dark S01'), isPlainName('a/b'), isPlainName('x.'), isPlainName('')]).toEqual([true, false, false, false]);
    expect([formatDuration(7112), formatDuration(1330)]).toEqual(['1:58:32', '22:10']);
    expect(languageName('deu', 'German')).toBe('Deutsch');
    expect(languageName(null, 'German')).toBe('German');
  });
});
