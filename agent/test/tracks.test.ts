import { describe, expect, it } from 'vitest';
import { familyOf, languageKey, matchStreams, soundQuality, suggestKeep, type TrackLike } from '../src/tracks.js';

const audio = (language: string | null, codec: string, channels: number, codecId: string | null = null): TrackLike => ({ type: 'audio', language, codec, codecId, channels });
const subtitle = (language: string | null, codec = 'PGS'): TrackLike => ({ type: 'subtitles', language, codec, codecId: 'S_HDMV/PGS', channels: null });
const video: TrackLike = { type: 'video', language: null, codec: 'HEVC', codecId: 'V_MPEGH/ISO/HEVC', channels: null };

describe('which tracks to keep', () => {
  it('knows languages and formats however they are spelled', () => {
    expect(['deu', 'ger', 'de', 'de-CH', 'gsw'].map(languageKey)).toEqual(['ger', 'ger', 'ger', 'ger', 'ger']);
    expect([languageKey('und'), languageKey(null), languageKey('fra'), languageKey('en')]).toEqual([null, null, 'fre', 'eng']);
    // MakeMKV's short names and mkvmerge's names.
    expect(['DTS-HD MA', 'DTS-HD Master Audio', 'DTS', 'DD', 'AC-3', 'DD+', 'E-AC-3', 'TrueHD Atmos', 'LPCM', 'FLAC', 'PGS'].map((codec) => familyOf({ codec, codecId: null }))).toEqual([
      'dts-ma',
      'dts-ma',
      'dts',
      'ac3',
      'ac3',
      'eac3',
      'eac3',
      'truehd',
      'pcm',
      'pcm',
      'pgs',
    ]);
  });

  it('ranks the sound: lossless, then channels, then the format', () => {
    const order = [audio('eng', 'DD', 2), audio('eng', 'DTS', 6), audio('eng', 'DD', 6), audio('eng', 'TrueHD', 8), audio('eng', 'DTS-HD MA', 6), audio('eng', 'DD+', 8)]
      .sort((a, b) => soundQuality(b) - soundQuality(a))
      .map((track) => `${track.codec} ${track.channels}`);
    expect(order).toEqual(['TrueHD 8', 'DTS-HD MA 6', 'DD+ 8', 'DTS 6', 'DD 6', 'DD 2']);
  });

  it('suggests the first track’s language and German, each in its best sound, and the first and German subtitles', () => {
    // A Blu-ray: English first (TrueHD with its AC-3 core), a commentary, German in DTS and stereo, French, Spanish.
    const tracks = [
      video,
      audio('eng', 'TrueHD', 8),
      audio('eng', 'DD', 6),
      audio('eng', 'DD', 2),
      audio('deu', 'DD', 2),
      audio('deu', 'DTS', 6),
      audio('fra', 'DD', 6),
      audio('spa', 'DD', 6),
      subtitle('eng'),
      subtitle('deu'),
      subtitle('fra'),
      subtitle('deu'),
    ];
    expect([...suggestKeep(tracks)].sort((a, b) => a - b)).toEqual([0, 1, 5, 8, 9, 11]);
    // A German DVD: German first – only German stays, the best of it.
    expect([...suggestKeep([audio('deu', 'DD', 2), audio('deu', 'DD', 6), audio('eng', 'DD', 6)])]).toEqual([1]);
    // Of two as good, the earlier: the film, not the commentary.
    expect([...suggestKeep([audio('eng', 'DD', 2), audio('eng', 'DD', 2), audio('deu', 'DD', 2)])].sort()).toEqual([0, 2]);
    // A first track without a language stays as it is.
    expect([...suggestKeep([audio(null, 'DD', 2), audio('fra', 'DD', 6)])]).toEqual([0]);
    // Another preferred language.
    expect([...suggestKeep([audio('eng', 'DD', 6), audio('ita', 'DD', 6), audio('deu', 'DD', 6)], 'ita')].sort()).toEqual([0, 1]);
  });

  it('finds the chosen disc streams again in the file, also reordered and without the streams MakeMKV left out', () => {
    const streams = [audio('eng', 'TrueHD', 8), audio('eng', 'DD', 6), audio('deu', 'DTS-HD MA', 6), audio('deu', 'DTS', 6), audio('fra', 'DD', 6)];
    // Chosen: English TrueHD and German DTS-HD MA.
    const chosen = new Set([0, 2]);
    // MakeMKV left out the AC-3 core and wrote German first; mkvmerge names the formats its own way.
    const file = [
      { ...audio('ger', 'DTS-HD Master Audio', 6, 'A_DTS'), id: 1 },
      { ...audio('ger', 'DTS', 6, 'A_DTS'), id: 2 },
      { ...audio('eng', 'TrueHD Atmos', 8, 'A_TRUEHD'), id: 3 },
      { ...audio('fre', 'AC-3', 6, 'A_AC3'), id: 4 },
    ];
    expect(matchStreams(file, streams, chosen)).toEqual({ keep: [1, 3], unmatched: 0 });
    // A track the disc did not list stays: nothing is lost that cannot be told apart.
    expect(matchStreams([...file, { ...audio('jpn', 'AC-3', 2), id: 5 }], streams, chosen)).toEqual({ keep: [1, 3, 5], unmatched: 1 });
    // Subtitles go by language, in order.
    const subtitles = [subtitle('eng'), subtitle('deu'), subtitle('deu'), subtitle('fra')];
    const fileSubtitles = [subtitle('eng'), subtitle('ger'), subtitle('ger'), subtitle('fre')].map((track, index) => ({ ...track, id: 10 + index }));
    expect(matchStreams(fileSubtitles, subtitles, new Set([0, 2])).keep).toEqual([10, 12]);
  });
});
