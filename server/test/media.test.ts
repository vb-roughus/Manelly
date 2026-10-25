import { describe, expect, it } from 'vitest';
import type { MediaIndexStatus, MediaSearchResponse } from '@manelly/shared';
import { buildApp } from '../src/app.js';
import { createConnection } from '../src/connection.js';
import { createJellyfinClient } from '../src/jellyfin/client.js';
import type { JfBaseItem, JfMediaStream } from '../src/jellyfin/types.js';
import { buildMediaIndex } from '../src/media/indexer.js';
import { searchMedia } from '../src/media/search.js';
import { createMediaIndexStore } from '../src/media/store.js';
import { audioFormats, canonicalLanguage, dynamicRangeOf, resolutionOf, videoCodecFamily } from '../src/media/streams.js';

const audio = (Language: string, Codec: string, Profile?: string, Channels = 6, Title?: string): JfMediaStream => ({
  Type: 'Audio',
  Language,
  Codec,
  Profile,
  Channels,
  Title,
});
const video4k: JfMediaStream = { Type: 'Video', Codec: 'hevc', Width: 3840, Height: 1600, VideoRangeType: 'DOVIWithHDR10' };
const video1080: JfMediaStream = { Type: 'Video', Codec: 'h264', Width: 1920, Height: 1080, VideoRangeType: 'SDR' };
const ATMOS_TRUEHD = 'Dolby TrueHD + Dolby Atmos';
const ATMOS_DDP = 'Dolby Digital Plus + Dolby Atmos';

describe('stream classification', () => {
  it('normalizes the language codes Jellyfin stores', () => {
    expect(['ger', 'deu', 'de', 'GER'].map(canonicalLanguage)).toEqual(['de', 'de', 'de', 'de']);
    expect(canonicalLanguage('eng')).toBe('en');
    expect([undefined, '', 'und', 'zxx', 'qaa', 'not a code'].map(canonicalLanguage)).toEqual([null, null, null, null, null, null]);
  });

  it.each([
    [{ Codec: 'truehd', Profile: ATMOS_TRUEHD }, ['truehd', 'atmos']],
    [{ Codec: 'eac3', Profile: ATMOS_DDP }, ['eac3', 'atmos']],
    [{ Codec: 'truehd', Title: 'Deutsch Dolby Atmos 7.1' }, ['truehd', 'atmos']],
    [{ Codec: 'truehd' }, ['truehd']],
    [{ Codec: 'ac3', Title: 'AC3 5.1 (Atmos Core)' }, ['ac3']],
    [{ Codec: 'dts', Profile: 'DTS-HD MA + DTS:X' }, ['dts-hd-ma', 'dtsx']],
    [{ Codec: 'dts', Profile: 'DTS-HD MA' }, ['dts-hd-ma']],
    [{ Codec: 'dts', Profile: 'DTS-HD HRA' }, ['dts-hd']],
    [{ Codec: 'dts', Profile: 'DTS Express' }, ['dts']],
    [{ Codec: 'pcm_s24le' }, ['pcm']],
    [{ Codec: 'aac', Profile: 'LC' }, ['aac']],
    [{ Codec: 'wmapro' }, ['other']],
  ])('%o → %o', (stream, expected) => {
    expect(audioFormats(stream)).toEqual(expected);
  });

  it('classifies video', () => {
    expect(resolutionOf(3840, 1600)).toBe('4K');
    expect(resolutionOf(1920, 800)).toBe('1080p');
    expect(resolutionOf(1280, 720)).toBe('720p');
    expect(resolutionOf(720, 576)).toBe('SD');
    expect(dynamicRangeOf({ VideoRangeType: 'DOVIWithHDR10' })).toBe('DV');
    expect(dynamicRangeOf({ VideoRangeType: 'HDR10Plus' })).toBe('HDR10+');
    expect(dynamicRangeOf({ VideoRange: 'HDR' })).toBe('HDR10');
    expect(['hevc', 'H265', 'h264', 'avc', 'av1', 'msmpeg4v3', 'mpeg2video', 'wmv3', 'prores', undefined].map(videoCodecFamily)).toEqual([
      'hevc',
      'hevc',
      'h264',
      'h264',
      'av1',
      'mpeg4',
      'mpeg2',
      'vc1',
      'other',
      null,
    ]);
  });
});

// --- A small fake library --------------------------------------------------

const MOVIES_LIB = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1';
const SHOWS_LIB = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2';

const movie = (Id: string, Name: string, streams: JfMediaStream[], extra: Partial<JfBaseItem> = {}): JfBaseItem => ({
  Id,
  Name,
  Type: 'Movie',
  ProductionYear: 2020,
  Genres: ['Drama'],
  ImageTags: { Primary: `tag-${Id}` },
  MediaSources: [{ Name: Name, Container: 'mkv', MediaStreams: streams }],
  ...extra,
});

const episode = (Id: string, SeriesId: string, season: number, number: number, streams: JfMediaStream[]): JfBaseItem => ({
  Id,
  Name: `Folge ${number}`,
  Type: 'Episode',
  SeriesId,
  ParentIndexNumber: season,
  IndexNumber: number,
  MediaSources: [{ MediaStreams: [video1080, ...streams] }],
});

const MOVIES: JfBaseItem[] = [
  // German DTS and English Atmos: must NOT count as "German Atmos".
  movie('m1', 'Mixed Tracks', [video4k, audio('ger', 'dts', 'DTS-HD MA'), audio('eng', 'truehd', ATMOS_TRUEHD, 8)]),
  movie('m2', 'German TrueHD Atmos', [video4k, audio('ger', 'truehd', ATMOS_TRUEHD, 8), audio('eng', 'truehd', ATMOS_TRUEHD, 8)], {
    ProductionYear: 2023,
    CommunityRating: 8.1,
    Genres: ['Action', 'Science Fiction'],
  }),
  movie('m3', 'Amélie', [video1080, audio('fre', 'ac3'), audio('deu', 'eac3', ATMOS_DDP)], { ProductionYear: 2001, CommunityRating: 7.9 }),
  movie('m4', 'Only English', [video1080, audio('eng', 'aac', 'LC', 2)], { ProductionYear: 1999, Genres: ['Komödie'] }),
  // Two versions: only the 4K file has the German Atmos track.
  {
    ...movie('m5', 'Two Versions', []),
    MediaSources: [
      { Name: '1080p', MediaStreams: [video1080, audio('ger', 'ac3')] },
      { Name: '2160p', MediaStreams: [video4k, audio('ger', 'truehd', ATMOS_TRUEHD, 8)] },
    ],
  },
];

const SERIES: JfBaseItem[] = [
  { Id: 's1', Name: 'Complete Atmos', Type: 'Series', ProductionYear: 2019, EndDate: '2021-05-01T00:00:00Z', Genres: ['Drama'] },
  { Id: 's2', Name: 'Partial Atmos', Type: 'Series', ProductionYear: 2022, Genres: ['Krimi'] },
];

const EPISODES: JfBaseItem[] = [
  episode('e1', 's1', 1, 1, [audio('ger', 'eac3', ATMOS_DDP)]),
  episode('e2', 's1', 1, 2, [audio('ger', 'eac3', ATMOS_DDP)]),
  episode('e3', 's2', 1, 1, [audio('ger', 'eac3', ATMOS_DDP)]),
  episode('e4', 's2', 1, 2, [audio('ger', 'ac3'), audio('eng', 'eac3', ATMOS_DDP)]),
  episode('e5', 's2', 2, 1, [audio('ger', 'aac')]),
];

const fakeJellyfin: typeof fetch = async (input) => {
  const url = new URL(String(input));
  if (url.pathname === '/Library/VirtualFolders') {
    return Response.json([
      { Name: 'Filme', ItemId: MOVIES_LIB, CollectionType: 'movies' },
      { Name: 'Serien', ItemId: SHOWS_LIB, CollectionType: 'tvshows' },
      { Name: 'Musik', ItemId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3', CollectionType: 'music' },
    ]);
  }
  if (url.pathname === '/Items') {
    const parent = url.searchParams.get('parentId');
    const type = url.searchParams.get('includeItemTypes');
    const all =
      parent === MOVIES_LIB && type === 'Movie'
        ? MOVIES
        : parent === SHOWS_LIB && type === 'Series'
          ? SERIES
          : parent === SHOWS_LIB && type === 'Episode'
            ? EPISODES
            : [];
    const start = Number(url.searchParams.get('startIndex') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? all.length);
    return Response.json({ Items: all.slice(start, start + limit), TotalRecordCount: all.length });
  }
  return new Response(null, { status: 404 });
};

const client = createJellyfinClient({ url: 'http://jellyfin.test', apiKey: 'key' }, { fetch: fakeJellyfin });

describe('media index', () => {
  it('loads movies and series with their episodes and reports progress', async () => {
    const progress: number[][] = [];
    const index = await buildMediaIndex(client, (loaded, total) => progress.push([loaded, total]));

    expect(index.counts).toEqual({ movies: 5, series: 2, episodes: 5 });
    expect(progress.at(-1)).toEqual([12, 12]);
    expect(index.byId.get('s2')?.episodes.map((e) => e.id)).toEqual(['e3', 'e4', 'e5']);
    expect(index.facets.libraries.map((l) => l.name)).toEqual(['Filme', 'Serien']);
    expect(index.facets.audioLanguages.find((f) => f.value === 'de')?.count).toBe(6);
    expect(index.facets.years).toEqual({ min: 1999, max: 2023 });
  });
});

describe('media search', async () => {
  const index = await buildMediaIndex(client);
  const names = (params: Parameters<typeof searchMedia>[1]) => searchMedia(index, params).items.map((item) => item.name);

  it('finds German Atmos only when both hold for the same track', () => {
    expect(names({ type: 'Movie', audioLanguage: ['de'], audioFormat: ['atmos'] })).toEqual([
      'Amélie',
      'German TrueHD Atmos',
      'Two Versions',
    ]);
  });

  it('matches the codec of an Atmos track too, and minimum channels', () => {
    expect(names({ type: 'Movie', audioLanguage: ['de'], audioFormat: ['truehd'] })).toEqual(['German TrueHD Atmos', 'Two Versions']);
    expect(names({ type: 'Movie', audioLanguage: ['de'], audioMinChannels: 8 })).toEqual(['German TrueHD Atmos', 'Two Versions']);
  });

  it('finds titles that lack a track', () => {
    expect(names({ type: 'Movie', audioLanguage: ['de'], audioMode: 'lacks' })).toEqual(['Only English']);
  });

  it('reports episode coverage for series and can require all episodes', () => {
    const filter = { type: 'Series' as const, audioLanguage: ['de'], audioFormat: ['atmos' as const] };
    const result = searchMedia(index, filter).items;
    expect(result.map((item) => [item.name, item.episodes])).toEqual([
      ['Complete Atmos', { total: 2, matching: 2 }],
      ['Partial Atmos', { total: 3, matching: 1 }],
    ]);
    expect(names({ ...filter, audioCoverage: 'all' })).toEqual(['Complete Atmos']);
    expect(names({ ...filter, audioMode: 'lacks' })).toEqual(['Partial Atmos']);
  });

  it('puts the matching tracks first in the badges', () => {
    const [mixed] = searchMedia(index, { q: 'mixed', audioLanguage: ['en'], audioFormat: ['atmos'] }).items;
    expect(mixed?.audio[0]).toEqual({ language: 'en', format: 'atmos', channels: 8, matches: true });
    expect(mixed?.audio[1]).toMatchObject({ language: 'de', format: 'dts-hd-ma', matches: false });
  });

  it('applies the standard filters', () => {
    expect(names({ q: 'amelie' })).toEqual(['Amélie']);
    expect(names({ genre: ['Action', 'Komödie'] })).toEqual(['German TrueHD Atmos', 'Only English']);
    expect(names({ yearFrom: 2000, yearTo: 2020, type: 'Movie' })).toEqual(['Amélie', 'Mixed Tracks', 'Two Versions']);
    expect(names({ minRating: 8 })).toEqual(['German TrueHD Atmos']);
    expect(names({ resolution: ['4K'], dynamicRange: ['DV'] })).toEqual(['German TrueHD Atmos', 'Mixed Tracks', 'Two Versions']);
    expect(names({ library: [SHOWS_LIB] })).toEqual(['Complete Atmos', 'Partial Atmos']);
    // A movie counts for every codec among its versions; series for those of their episodes.
    expect(names({ videoCodec: ['hevc'] })).toEqual(['German TrueHD Atmos', 'Mixed Tracks', 'Two Versions']);
    expect(names({ videoCodec: ['h264'], type: 'Series' })).toEqual(['Complete Atmos', 'Partial Atmos']);
    expect(index.facets.videoCodecs).toEqual([
      { value: 'h264', count: 5 },
      { value: 'hevc', count: 3 },
    ]);
  });

  it('sorts and pages', () => {
    expect(names({ type: 'Movie', sort: 'year', order: 'desc', limit: 2 })).toEqual(['German TrueHD Atmos', 'Mixed Tracks']);
    expect(searchMedia(index, { type: 'Movie', offset: 4 })).toMatchObject({ total: 5, items: [{ name: 'Two Versions' }] });
  });
});

describe('media routes', () => {
  async function setup() {
    const connection = await createConnection({
      store: { load: async () => ({ url: 'http://jellyfin.test', apiKey: 'key' }), save: async () => {} },
      envSettings: null,
      createClient: (settings) => createJellyfinClient(settings, { fetch: fakeJellyfin }),
    });
    const app = await buildApp({ config: { staticDir: null }, connection, mediaStore: createMediaIndexStore(connection) });
    return app;
  }

  async function waitUntilReady(app: Awaited<ReturnType<typeof setup>>) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const status = (await app.inject('/api/media/status')).json<MediaIndexStatus>();
      if (status.state === 'ready') return status;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('index not ready');
  }

  it('builds the index on first use and searches it', async () => {
    const app = await setup();
    const first = (await app.inject('/api/media/search')).json<MediaSearchResponse>();
    expect(first.index.state).toBe('building');

    const status = await waitUntilReady(app);
    expect(status.counts).toEqual({ movies: 5, series: 2, episodes: 5 });

    const search = await app.inject('/api/media/search?audioLanguage=de&audioFormat=atmos&type=Movie&sort=name');
    expect(search.statusCode).toBe(200);
    expect(search.json<MediaSearchResponse>().total).toBe(3);

    const movie = (await app.inject('/api/media/items/m1?audioLanguage=en&audioFormat=atmos')).json();
    expect(movie.versions[0].audio.map((track: { language: string; matches: boolean }) => [track.language, track.matches])).toEqual([
      ['de', false],
      ['en', true],
    ]);

    const detail = await app.inject('/api/media/items/s2?audioLanguage=de&audioFormat=atmos');
    expect(detail.json().seasons.map((s: { episodes: Array<{ matches: boolean }> }) => s.episodes.map((e) => e.matches))).toEqual([
      [true, false],
      [false],
    ]);

    expect((await app.inject('/api/media/facets')).json().facets.genres[0]).toEqual({ value: 'Drama', count: 4 });
    expect((await app.inject('/api/media/items/unknown')).statusCode).toBe(404);
    expect((await app.inject('/api/media/search?audioFormat=nonsense')).statusCode).toBe(400);
  });
});
