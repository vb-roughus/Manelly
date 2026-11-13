import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAudioFixer, matchesLanguage, mkvFiles, mkvpropeditFor, planAudio, preferAudio, type MkvTrack } from '../src/audio.js';

const MKVMERGE = fileURLToPath(new URL('./fixtures/fake-mkvmerge.cjs', import.meta.url));

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'manelly-audio-'));
});
afterEach(async () => {
  delete process.env.FAKE_MKVMERGE_FAIL;
  await rm(root, { recursive: true, force: true });
});

const track = (id: number, type: string, language: string | null, flags: { default?: boolean; forced?: boolean; ietf?: string } = {}) => ({
  id,
  type,
  properties: { number: id + 1, language, language_ietf: flags.ietf ?? null, default_track: flags.default ?? false, forced_track: flags.forced ?? false },
});

/** A DVD rip as MakeMKV writes it: English first and default, German second, English subtitles marked default. */
const RIP = [
  track(0, 'video', 'und', { default: true }),
  track(1, 'audio', 'eng', { default: true }),
  track(2, 'audio', 'ger'),
  track(3, 'subtitles', 'eng', { default: true }),
  track(4, 'subtitles', 'ger', { forced: true, default: true }),
];

async function mkv(name: string, tracks = RIP): Promise<string> {
  const file = path.join(root, name);
  await mkdir(path.dirname(file), { recursive: true });
  // Some padding, so a much smaller result would show.
  await writeFile(file, JSON.stringify({ tracks, padding: 'x'.repeat(2000) }));
  return file;
}

const tracksOf = async (file: string) => (JSON.parse(await readFile(file, 'utf8')) as { tracks: typeof RIP }).tracks;
const summary = (tracks: typeof RIP) => tracks.map((entry) => `${entry.type}:${entry.properties.language}${entry.properties.default_track ? '*' : ''}`);

const asTracks = (tracks: typeof RIP): MkvTrack[] =>
  tracks.map((entry) => ({
    id: entry.id,
    type: entry.type,
    number: entry.properties.number,
    language: entry.properties.language,
    languageIetf: entry.properties.language_ietf,
    default: entry.properties.default_track,
    forced: entry.properties.forced_track,
  }));

describe('the preferred audio track', () => {
  it('knows a language by any of its codes', () => {
    expect(matchesLanguage({ language: 'deu', languageIetf: null }, 'ger')).toBe(true);
    expect(matchesLanguage({ language: 'und', languageIetf: 'de-CH' }, 'ger')).toBe(true);
    expect(matchesLanguage({ language: 'eng', languageIetf: 'en' }, 'ger')).toBe(false);
  });

  it('plans the default flags, the order, and the subtitles in another language', () => {
    const plan = planAudio(asTracks(RIP), 'ger', true);
    expect(plan.preferred?.id).toBe(2);
    expect(plan.flags.map(({ track, value }) => [track.id, value])).toEqual([
      [1, false],
      [2, true],
      // English subtitles would show over the German sound; forced German ones stay.
      [3, false],
    ]);
    expect(plan.order).toEqual([0, 2, 1, 3, 4]);
    expect(planAudio(asTracks(RIP), 'ger', false).order).toBeNull();
    expect(planAudio(asTracks(RIP), 'ita', true)).toEqual({ preferred: null, flags: [], order: null });
  });

  it('finds mkvpropedit next to mkvmerge', () => {
    expect(mkvpropeditFor('C:\\Program Files\\MKVToolNix\\mkvmerge.exe')).toBe('C:\\Program Files\\MKVToolNix\\mkvpropedit.exe');
    expect(mkvpropeditFor('/usr/bin/mkvmerge')).toBe('/usr/bin/mkvpropedit');
    expect(mkvpropeditFor('mkvmerge')).toBe('mkvpropedit');
  });

  it('puts the German track first and makes it the default, writing the file anew', async () => {
    const file = await mkv('Film.mkv');
    expect(await preferAudio(file, { mkvmerge: MKVMERGE, language: 'ger', first: true })).toEqual({
      changed: true,
      message: 'Die deutsche Tonspur steht jetzt zuerst und ist Standard.',
    });
    expect(summary(await tracksOf(file))).toEqual(['video:und*', 'audio:ger*', 'audio:eng', 'subtitles:eng', 'subtitles:ger*']);
    // Nothing of the scratch folder stays.
    expect(await readdir(root)).toEqual(['Film.mkv']);
    // Again: nothing to do.
    expect(await preferAudio(file, { mkvmerge: MKVMERGE, language: 'ger', first: true })).toEqual({
      changed: false,
      message: 'Die deutsche Tonspur ist schon Standard und steht zuerst.',
    });
  });

  it('only sets the flags with mkvpropedit when the order may stay', async () => {
    const file = await mkv('Film.mkv');
    expect((await preferAudio(file, { mkvmerge: MKVMERGE, language: 'ger', first: false })).message).toBe('Die deutsche Tonspur ist jetzt Standard.');
    expect(summary(await tracksOf(file))).toEqual(['video:und*', 'audio:eng', 'audio:ger*', 'subtitles:eng', 'subtitles:ger*']);
  });

  it('writes the file anew with mkvmerge when mkvpropedit is missing', async () => {
    const alone = path.join(root, 'tools', 'mkvmerge.cjs');
    await mkdir(path.dirname(alone));
    await copyFile(MKVMERGE, alone);
    const file = await mkv('Film.mkv');
    await preferAudio(file, { mkvmerge: alone, language: 'ger', first: false });
    // Same order, new flags.
    expect(summary(await tracksOf(file))).toEqual(['video:und*', 'audio:eng', 'audio:ger*', 'subtitles:eng', 'subtitles:ger*']);
  });

  it('leaves a file without German sound, and one mkvmerge failed on, as it was', async () => {
    const english = await mkv('English.mkv', [track(0, 'video', 'und'), track(1, 'audio', 'eng', { default: true })]);
    expect(await preferAudio(english, { mkvmerge: MKVMERGE, language: 'ger', first: true })).toEqual({ changed: false, message: 'Keine deutsche Tonspur.' });

    const file = await mkv('Film.mkv');
    const before = await readFile(file, 'utf8');
    process.env.FAKE_MKVMERGE_FAIL = '1';
    await expect(preferAudio(file, { mkvmerge: MKVMERGE, language: 'ger', first: true })).rejects.toThrow(/Exit-Code 2\): Error: no space left on device\./);
    expect(await readFile(file, 'utf8')).toBe(before);
    expect((await readdir(root)).sort()).toEqual(['English.mkv', 'Film.mkv']);

    await writeFile(path.join(root, 'kaputt.mkv'), 'kein mkv');
    await expect(preferAudio(path.join(root, 'kaputt.mkv'), { mkvmerge: MKVMERGE, language: 'ger', first: true })).rejects.toThrow('The type of file could not be recognized.');
  });

  it('finds the MKV files of a folder, without the scratch folders', async () => {
    await mkv('Serie/S01/Folge 1.mkv');
    await mkv('Serie/S01/Folge 2.mkv');
    await mkv('Serie/.manelly-tmp-x/Halb.mkv');
    await writeFile(path.join(root, 'Serie', 'info.nfo'), '');
    expect((await mkvFiles(path.join(root, 'Serie'))).map((file) => path.relative(root, file))).toEqual([path.join('Serie', 'S01', 'Folge 1.mkv'), path.join('Serie', 'S01', 'Folge 2.mkv')]);
    expect(await mkvFiles(path.join(root, 'Serie', 'info.nfo'))).toEqual([]);
    await expect(mkvFiles(path.join(root, 'weg'))).rejects.toThrow('Gibt es im Entpack-Ordner nicht (mehr).');
  });
});

describe('setting the audio track in many files', () => {
  it('works through them one after the other, says what it did, and tells Jellyfin about the changed ones', async () => {
    const changed = await mkv('A.mkv');
    const done = await mkv('B.mkv', [track(0, 'video', 'und'), track(1, 'audio', 'ger', { default: true })]);
    const busy = await mkv('C.mkv');
    const told: unknown[] = [];
    const fixer = createAudioFixer({ tool: async () => MKVMERGE, notify: async (updates) => told.push(...updates) });
    const task = fixer.start(
      [
        { path: changed, shown: 'A.mkv', busy: null },
        { path: done, shown: 'B.mkv', busy: null },
        { path: busy, shown: 'C.mkv', busy: 'Wird gerade konvertiert – danach nochmals.' },
      ],
      { language: 'ger', first: true, library: true },
    );
    expect(task).toMatchObject({ state: 'running', total: 3, done: 0 });
    expect(() => fixer.start([{ path: changed, shown: 'A.mkv', busy: null }], { language: 'ger', first: true, library: true })).toThrow(/schon Tonspuren/);
    await fixer.idle();
    expect(fixer.status()).toMatchObject({
      state: 'done',
      done: 3,
      current: null,
      results: [
        { path: 'A.mkv', changed: true, message: 'Die deutsche Tonspur steht jetzt zuerst und ist Standard.' },
        { path: 'B.mkv', changed: false, message: 'Die deutsche Tonspur ist schon Standard und steht zuerst.' },
        { path: 'C.mkv', changed: false, message: 'Wird gerade konvertiert – danach nochmals.', error: true },
      ],
    });
    expect(told).toEqual([{ Path: changed, UpdateType: 'Modified' }]);
  });

  it('says when mkvmerge is missing, and that there is nothing to do', async () => {
    const fixer = createAudioFixer({ tool: async () => null });
    expect(() => fixer.start([], { language: 'ger', first: true, library: false })).toThrow('Keine MKV-Dateien gefunden.');
    fixer.start([{ path: await mkv('A.mkv'), shown: 'A.mkv', busy: null }], { language: 'ger', first: true, library: false });
    await fixer.idle();
    expect(fixer.status()?.results).toEqual([{ path: 'A.mkv', changed: false, message: 'mkvmerge fehlt auf dem Server – MKVToolNix installieren.', error: true }]);
  });
});
