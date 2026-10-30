import { describe, expect, it } from 'vitest';
import { describeDolbyVision, dolbyVisionLabel, guessSeriesName, isExtractedFile, isFolderName, joinFolder } from './extracted';

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

describe('Dolby Vision in the extraction folder', () => {
  it('labels the profile, for profile 8 with what the base layer is', () => {
    expect(dolbyVisionLabel({ profile: 7, compatibility: 6, enhancementLayer: true })).toBe('DV P7');
    expect(dolbyVisionLabel({ profile: 8, compatibility: 1, enhancementLayer: false })).toBe('DV P8.1');
    expect(dolbyVisionLabel({ profile: 8, compatibility: 4, enhancementLayer: false })).toBe('DV P8.4');
    expect(dolbyVisionLabel({ profile: 8, compatibility: null, enhancementLayer: false })).toBe('DV P8');
    expect(dolbyVisionLabel({ profile: 5, compatibility: 0, enhancementLayer: false })).toBe('DV P5');
    expect(describeDolbyVision({ profile: 7, compatibility: 6, enhancementLayer: true })).toBe('Dolby Vision Profil 7, Basis HDR10 (Blu-ray), mit Enhancement Layer');
    expect(describeDolbyVision({ profile: 5, compatibility: 0, enhancementLayer: false })).toBe('Dolby Vision Profil 5');
  });

  it('finds a conversion of an entry by its path on the server', () => {
    expect(isExtractedFile('D:\\Entpackt\\Dune (2024)\\Dune.mkv', 'D:\\Entpackt', 'Dune (2024)/Dune.mkv')).toBe(true);
    expect(isExtractedFile('D:\\Entpackt\\Dune (2024)\\Dune.mkv', 'd:/entpackt/', 'Dune (2024)/Dune.mkv')).toBe(true);
    expect(isExtractedFile('/srv/entpackt/Dune.mkv', '/srv/entpackt', 'Dune.mkv')).toBe(true);
    expect(isExtractedFile('D:\\Entpackt\\Dune.mkv', 'D:\\Entpackt', 'Dune (2024)/Dune.mkv')).toBe(false);
  });
});
