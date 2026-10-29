import { describe, expect, it } from 'vitest';
import { guessSeriesName, isFolderName, joinFolder } from './extracted';

describe('new series folders', () => {
  it('guesses the series name from release names, with the year as Jellyfin likes it', () => {
    expect(guessSeriesName(['The.Expanse.S05.German.DL.1080p.WEB.x264-GROUP'])).toBe('The Expanse');
    expect(guessSeriesName(['Dark.2017.S01E01.German.1080p.mkv'])).toBe('Dark (2017)');
    expect(guessSeriesName(['Dark (2017) - S02E03.mkv'])).toBe('Dark (2017)');
    expect(guessSeriesName(['Babylon_Berlin_Staffel_4'])).toBe('Babylon Berlin');
    expect(guessSeriesName(['1923.S02E01.mkv'])).toBe('1923');
    expect(guessSeriesName(['cover.jpg', 'Severance.S02.2160p'])).toBe('Severance');
    expect(guessSeriesName(['Dune.Part.Two.2024.German.1080p.mkv'])).toBe('');
    expect(guessSeriesName(['S01E01.mkv'])).toBe('');
  });

  it('takes only a plain folder name', () => {
    expect(isFolderName('Dark (2017)')).toBe(true);
    for (const name of ['', '.', '..', 'a/b', 'a\\b', 'C:', 'Dark.', 'Dark ', 'CON', 'nul.txt', 'x'.repeat(201)]) expect(isFolderName(name)).toBe(false);
  });

  it('joins with the separator of the library folder', () => {
    expect(joinFolder('D:\\Serien', 'Dark (2017)')).toBe('D:\\Serien\\Dark (2017)');
    expect(joinFolder('\\\\nas\\serien\\', 'Dark')).toBe('\\\\nas\\serien\\Dark');
    expect(joinFolder('/mnt/serien', 'Dark')).toBe('/mnt/serien/Dark');
  });
});
