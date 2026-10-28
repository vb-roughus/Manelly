import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultFileName, isValidSegment, isWithin, pathApiFor, planOutput } from '../src/paths.js';
import { parseVersion } from '../src/tools.js';
import { frameRateFromNumber } from '../src/convert.js';

describe('path rules', () => {
  it('accepts only single, Windows-safe names', () => {
    expect(isValidSegment('Pitch Black (2000) - DV P8.mkv')).toBe(true);
    for (const name of ['', '..', 'a/b.mkv', 'a\\b.mkv', 'film?.mkv', 'film.mkv.', 'CON.mkv', 'nul']) {
      expect(isValidSegment(name)).toBe(false);
    }
  });

  it('compares Windows paths without regard to case', () => {
    expect(isWithin('D:\\Filme\\Pitch Black\\a.mkv', 'd:\\filme', path.win32)).toBe(true);
    expect(isWithin('D:\\Filme2\\a.mkv', 'D:\\Filme', path.win32)).toBe(false);
    expect(isWithin('/media/filme/../serien/a.mkv', '/media/filme', path.posix)).toBe(false);
    expect(pathApiFor('D:\\Filme\\a.mkv', 'linux')).toBe(path.win32);
    expect(pathApiFor('\\\\nas\\filme\\a.mkv', 'linux')).toBe(path.win32);
    expect(defaultFileName('D:\\Filme\\Pitch Black.m2ts', 'alongside')).toBe('Pitch Black - DV P8.mkv');
  });

  it('reads tool versions and frame rates', () => {
    expect(parseVersion('ffmpeg version 7.1.1-Jellyfin Copyright (c) 2000-2025')).toBe('7.1.1-Jellyfin');
    expect(parseVersion("mkvmerge v82.0 ('I'm The President') 64-bit")).toBe('82.0');
    expect(parseVersion('dovi_tool 2.3.4')).toBe('2.3.4');
    expect(frameRateFromNumber(23.976)).toBe('24000/1001');
    expect(frameRateFromNumber(25)).toBe('25/1');
    expect(frameRateFromNumber(null)).toBeNull();
  });
});

describe('planning the output', () => {
  let root: string;
  let source: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'manelly-plan-'));
    await mkdir(path.join(root, 'Filme', 'Film (2000)'), { recursive: true });
    await mkdir(path.join(root, 'UHD'));
    source = path.join(root, 'Filme', 'Film (2000)', 'Film (2000).mkv');
    await writeFile(source, 'video');
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('puts the file next to the original under a new name', async () => {
    expect(await planOutput({ source, output: { mode: 'alongside' } }, [])).toEqual({
      directory: path.dirname(source),
      output: path.join(path.dirname(source), 'Film (2000) - DV P8.mkv'),
      backup: null,
      createDirectory: false,
      work: null,
    });
    await expect(planOutput({ source, output: { mode: 'alongside', fileName: 'Film (2000).mkv' } }, [])).rejects.toThrow('anderen Namen');
  });

  it('replaces the original and keeps it in a backup folder', async () => {
    const plan = await planOutput({ source, output: { mode: 'replace' } }, []);
    expect(plan.output).toBe(source);
    expect(plan.backup).toBe(path.join(path.dirname(source), '.manelly-backup', 'Film (2000).mkv'));
    // An earlier backup is kept.
    await mkdir(path.dirname(plan.backup!));
    await writeFile(plan.backup!, 'old');
    expect((await planOutput({ source, output: { mode: 'replace' } }, [])).backup).toMatch(/Film \(2000\)\.\d{4}-\d\d-\d\dT[\d-]+\.mkv$/);
  });

  it('writes into another folder and creates the subfolder later', async () => {
    const plan = await planOutput({ source, output: { mode: 'folder', directory: path.join(root, 'UHD'), subfolder: 'Film (2000)' } }, []);
    expect(plan).toMatchObject({ directory: path.join(root, 'UHD', 'Film (2000)'), createDirectory: true });
    expect(plan.output).toBe(path.join(root, 'UHD', 'Film (2000)', 'Film (2000).mkv'));
  });

  it('connects what a path needs first, and says why it cannot be reached', async () => {
    const asked: string[] = [];
    const access = {
      prepare: async (file: string) => {
        asked.push(file);
        return file.includes('Netz') ? 'Das Netzlaufwerk Z: (\\\\nas\\filme) ist für den Agent nicht erreichbar: Zugriff verweigert.' : null;
      },
      networkHint: null,
    };
    await planOutput({ source, output: { mode: 'folder', directory: path.join(root, 'UHD') } }, [], process.platform, access);
    expect(asked).toEqual([source, path.join(root, 'UHD')]);
    await expect(planOutput({ source: path.join(root, 'Netz', 'Film.mkv'), output: { mode: 'alongside' } }, [], process.platform, access)).rejects.toThrow(
      'Das Netzlaufwerk Z: (\\\\nas\\filme) ist für den Agent nicht erreichbar: Zugriff verweigert.',
    );
    // A file it may not read is not «not found».
    const locked = path.join(root, 'Gesperrt');
    await mkdir(locked);
    await writeFile(path.join(locked, 'Film.mkv'), 'video');
    await chmod(locked, 0o000);
    try {
      if (process.getuid?.() !== 0) {
        await expect(planOutput({ source: path.join(locked, 'Film.mkv'), output: { mode: 'alongside' } }, [], process.platform, access)).rejects.toThrow(/^Kein Zugriff auf /);
      }
    } finally {
      await chmod(locked, 0o755);
    }
  });

  it('refuses unsafe or impossible requests', async () => {
    await expect(planOutput({ source: 'Film.mkv', output: { mode: 'alongside' } }, [])).rejects.toThrow('absoluten Pfad');
    await expect(planOutput({ source: path.join(root, 'a.avi'), output: { mode: 'alongside' } }, [])).rejects.toThrow('nicht unterstützt');
    await expect(planOutput({ source: path.join(root, 'fehlt.mkv'), output: { mode: 'alongside' } }, [])).rejects.toThrow('nicht gefunden');
    await expect(planOutput({ source, output: { mode: 'alongside' } }, [path.join(root, 'UHD')])).rejects.toThrow('ausserhalb');
    await expect(planOutput({ source, output: { mode: 'folder', directory: path.join(root, 'fehlt') } }, [])).rejects.toThrow('nicht gefunden');
    await expect(planOutput({ source, output: { mode: 'folder', directory: path.join(root, 'UHD'), subfolder: '../x' } }, [])).rejects.toThrow('Ordnername');
    await writeFile(path.join(path.dirname(source), 'Film (2000) - DV P8.mkv'), 'exists');
    await expect(planOutput({ source, output: { mode: 'alongside' } }, [])).rejects.toThrow('überschreibt keine Dateien');
  });
});
