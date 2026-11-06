import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DiscSettings } from '@manelly/shared';
import { createDiscs, ejectDisc, ejectScript, folderNameFrom, mainTitle } from '../src/discs.js';
import { createActivity, durationSeconds, parseDiscInfo, parseDrives, parseRobotLine, runMakemkv } from '../src/makemkv.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-makemkvcon.cjs', import.meta.url));

let root: string;
let target: string;
let statePath: string;
let ejected: string[];
let settings: DiscSettings;
let free: number | null;

async function insert(disc: 'movie' | 'series' | null, extra: Record<string, unknown> = {}) {
  await writeFile(statePath, JSON.stringify({ disc, label: disc === 'series' ? 'DARK_S1_D1' : 'FINDET_NEMO', ripMs: 40, ...extra }));
}

function service(tool: string | null = FAKE) {
  return createDiscs({
    tool: async () => tool,
    settings: { get: () => settings, set: async (next) => void (settings = next) },
    target: () => target,
    freeBytes: async () => free,
    eject: async (device) => {
      ejected.push(device);
      await insert(null);
    },
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'manelly-discs-'));
  target = path.join(root, 'entpackt');
  await mkdir(target);
  statePath = path.join(root, 'disc.json');
  process.env.FAKE_MAKEMKV = statePath;
  ejected = [];
  settings = { auto: false, eject: true };
  free = null;
  await insert('movie');
});

afterEach(async () => {
  delete process.env.FAKE_MAKEMKV;
  await rm(root, { recursive: true, force: true });
});

describe('makemkvcon output', () => {
  it('splits robot lines, with quotes and Windows paths in them', () => {
    expect(parseRobotLine('TINFO:0,9,0,"1:58:32"')).toEqual({ kind: 'TINFO', fields: ['0', '9', '0', '1:58:32'] });
    expect(parseRobotLine('MSG:5003,0,2,"Failed to save title 0 to file C:\\Rip\\a \\"b\\".mkv","x"')?.fields[3]).toBe('Failed to save title 0 to file C:\\Rip\\a "b".mkv');
    expect(parseRobotLine('DRV:0,2,999,1,"BD-RE  WH16NS40","DUNE, PART 2","D:"')?.fields).toEqual(['0', '2', '999', '1', 'BD-RE  WH16NS40', 'DUNE, PART 2', 'D:']);
    expect(parseRobotLine('kein robot')).toBeNull();
  });

  it('reads drives, discs and titles', () => {
    expect(
      parseDrives([
        'DRV:0,2,999,1,"HL-DT-ST DVDRAM GH24NSD1","FINDET_NEMO","D:"',
        'DRV:1,0,999,0,"ASUS BW-16D1HT","","E:"',
        'DRV:2,2,999,12,"ASUS BW-16D1HT","DUNE","F:"',
        'DRV:3,256,999,0,"","",""',
      ]),
    ).toEqual([
      { index: 0, state: 'inserted', name: 'HL-DT-ST DVDRAM GH24NSD1', device: 'D:', disc: 'FINDET_NEMO', kind: 'dvd' },
      { index: 1, state: 'empty', name: 'ASUS BW-16D1HT', device: 'E:', disc: null, kind: null },
      { index: 2, state: 'inserted', name: 'ASUS BW-16D1HT', device: 'F:', disc: 'DUNE', kind: 'bluray' },
    ]);
    expect(durationSeconds('1:58:32')).toBe(7112);
    const info = parseDiscInfo(
      0,
      [
        'CINFO:1,6206,"DVD disc"',
        'CINFO:2,0,"Findet Nemo"',
        'CINFO:32,0,"FINDET_NEMO"',
        'TINFO:0,8,0,"28"',
        'TINFO:0,9,0,"1:40:12"',
        'TINFO:0,11,0,"6400000000"',
        'SINFO:0,0,1,6201,"Video"',
        'SINFO:0,0,19,0,"720x576"',
        'SINFO:0,1,1,6202,"Audio"',
        'SINFO:0,1,3,0,"deu"',
        'SINFO:0,1,14,0,"6"',
        'SINFO:0,2,1,6203,"Subtitles"',
        'SINFO:0,2,3,0,"eng"',
        'TINFO:1,9,0,"0:00:30"',
      ],
      new Date('2026-11-06T10:00:00Z'),
    );
    expect(info).toEqual({
      drive: 0,
      name: 'Findet Nemo',
      label: 'FINDET_NEMO',
      type: 'DVD disc',
      readAt: '2026-11-06T10:00:00.000Z',
      titles: [
        {
          index: 0,
          durationSeconds: 6012,
          chapters: 28,
          bytes: 6_400_000_000,
          video: { size: '720x576', aspect: null, codec: null },
          audio: [{ language: 'deu', languageName: null, codec: null, channels: '6 Kanäle' }],
          subtitles: [{ language: 'eng', languageName: null, codec: null, channels: null }],
        },
      ],
    });
  });

  it('follows what MakeMKV is at, and leaves out what is meant for debugging', () => {
    const { activity, take } = createActivity({}, () => new Date('2026-11-06T10:00:00Z'));
    for (const line of [
      'MSG:1005,0,1,"MakeMKV v1.17.7 win(x64-release) started","%1 started"',
      'PRGT:5018,0,"Opening DVD disc"',
      'PRGC:5018,0,"Opening DVD disc"',
      'MSG:1011,32,1,"Debug: drive id","x"',
      'PRGC:5003,0,"Processing title sets"',
      'PRGV:100,32768,65536',
      'MSG:2003,0,3,"Error \'Scsi error - MEDIUM ERROR:L-EC UNCORRECTABLE ERROR\' occurred while reading \'/VIDEO_TS/VTS_01_1.VOB\' at offset \'1048576\'","x"',
      'MSG:3307,0,2,"File 00001.mpls was added as title #0","x"',
    ]) {
      take(line);
    }
    expect(activity).toEqual({
      step: 'Opening DVD disc – Processing title sets',
      stepProgress: 0.5,
      messages: [
        { at: '2026-11-06T10:00:00.000Z', text: "Error 'Scsi error - MEDIUM ERROR:L-EC UNCORRECTABLE ERROR' occurred while reading '/VIDEO_TS/VTS_01_1.VOB' at offset '1048576'", error: true },
        { at: '2026-11-06T10:00:00.000Z', text: 'File 00001.mpls was added as title #0', error: false },
      ],
    });
    take('PRGT:5017,0,"Saving to MKV file"');
    expect([activity.step, activity.stepProgress]).toEqual(['Saving to MKV file', null]);
  });

  it('ejects on Windows through the drive, with numbers Windows PowerShell takes as UInt32', async () => {
    const script = ejectScript('E');
    expect(script).toContain("CreateFile('\\\\.\\E:', [UInt32]2147483648,");
    // 0x80000000 is a negative Int32 for Windows PowerShell 5.1, which CreateFile refuses.
    expect(script).not.toMatch(/0x[89A-F][0-9A-F]{7}/i);
    expect(script).toContain('[UInt32]2967560');
    await expect(ejectDisc('/dev/sr0', 'win32')).rejects.toThrow('Unbekanntes Laufwerk «/dev/sr0».');
  });

  it('names folders after discs and finds the main title', () => {
    expect(folderNameFrom('FINDET_NEMO')).toBe('Findet Nemo');
    expect(folderNameFrom('Die Hard: With a Vengeance')).toBe('Die Hard With a Vengeance');
    expect(folderNameFrom('ÄRZTE_LIVE')).toBe('Ärzte Live');
    expect(folderNameFrom('___')).toBeNull();
    const title = (index: number, durationSeconds: number, bytes: number) => ({ index, durationSeconds, chapters: 1, bytes, video: null, audio: [], subtitles: [] });
    expect(mainTitle([title(0, 600, 1), title(1, 6000, 5), title(2, 6000, 9)])?.index).toBe(2);
    expect(mainTitle([])).toBeNull();
  });
});

describe('ripping discs', () => {
  it('reads the disc, rips the titles into a new folder, and ejects it', async () => {
    const discs = service();
    const status = await discs.status();
    expect(status).toMatchObject({ tool: FAKE, target, settings, error: null, rips: [], reads: [] });
    expect(status.drives).toEqual([{ index: 0, state: 'inserted', name: 'DVD-RW Fake Drive', device: '/dev/sr0', disc: 'FINDET_NEMO', kind: 'dvd', busy: false }]);

    expect(await discs.read(0)).toMatchObject({ drive: 0, state: 'reading' });
    await expect(discs.read(0)).rejects.toThrow('Das Laufwerk ist gerade beschäftigt.');
    for (let i = 0; i < 100 && (await discs.status()).reads[0]?.state === 'reading'; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    const read = (await discs.status()).reads[0]!;
    expect(read.state).toBe('done');
    // The 45 seconds title is a menu.
    expect(read.info?.titles.map((title) => [title.index, title.durationSeconds, title.bytes])).toEqual([
      [0, 7112, 600000],
      [1, 725, 60000],
    ]);
    expect(read.info?.titles[0]?.audio).toEqual([
      { language: 'deu', languageName: 'German', codec: 'AC3', channels: '5.1(side)' },
      { language: 'eng', languageName: 'English', codec: 'AC3', channels: 'stereo' },
    ]);

    const rip = await discs.rip({ drive: 0, folder: 'Findet Nemo (2003)', titles: [{ index: 0, fileName: 'Findet Nemo (2003).mkv' }, { index: 1, fileName: 'Extras.mkv' }] });
    expect(rip).toMatchObject({ disc: 'FINDET_NEMO', folder: 'Findet Nemo (2003)', state: 'queued', eject: true, auto: false });
    await discs.idle();
    const [done] = (await discs.status()).rips;
    expect(done).toMatchObject({ state: 'done', progress: 1, error: null });
    expect(done?.titles.map((title) => title.state)).toEqual(['done', 'done']);
    expect((await readdir(path.join(target, 'Findet Nemo (2003)'))).sort()).toEqual(['Extras.mkv', 'Findet Nemo (2003).mkv']);
    expect((await stat(path.join(target, 'Findet Nemo (2003)', 'Findet Nemo (2003).mkv'))).size).toBe(600000);
    // No scratch folder is left, and the disc came out.
    expect(await readdir(target)).toEqual(['Findet Nemo (2003)']);
    expect(ejected).toEqual(['/dev/sr0']);
  });

  it('shows how far reading is and what MakeMKV said, and stops reading when asked', async () => {
    await insert('movie', { readMs: 4000, readError: "Error 'Scsi error - MEDIUM ERROR' occurred while reading" });
    const discs = service();
    expect(() => discs.cancelRead(0)).toThrow('Von diesem Laufwerk wird gerade nichts gelesen.');
    await discs.read(0);
    for (let i = 0; i < 100 && !(await discs.status()).reads[0]?.stepProgress; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    const reading = (await discs.status()).reads[0]!;
    expect(reading).toMatchObject({ state: 'reading', step: 'Opening DVD disc – Scanning contents', startedAt: expect.any(String) });
    expect(reading.stepProgress).toBeGreaterThan(0);
    expect(reading.messages?.map((message) => [message.text, message.error])).toEqual([
      ['Using direct disc access mode', false],
      ["Error 'Scsi error - MEDIUM ERROR' occurred while reading", true],
    ]);
    expect(discs.cancelRead(0).drive).toBe(0);
    for (let i = 0; i < 100 && (await discs.status()).reads[0]?.state === 'reading'; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await discs.status()).reads[0]).toMatchObject({ state: 'canceled', error: 'Abgebrochen.' });
    expect((await discs.status()).drives[0]?.busy).toBe(false);
  });

  it('gives up on MakeMKV after a while, and says what it said last', async () => {
    await insert('movie', { readMs: 4000, readError: "Error 'Scsi error - MEDIUM ERROR' occurred while reading" });
    await expect(runMakemkv(FAKE, ['-r', '--progress=-same', 'info', 'disc:0'], { timeoutMs: 300 })).rejects.toThrow(
      "MakeMKV war nach 0 Sekunden nicht fertig und wurde abgebrochen. Zuletzt: Using direct disc access mode Error 'Scsi error - MEDIUM ERROR' occurred while reading",
    );
  });

  it('forgets the titles of a disc that was swapped by hand, and asks the drive again when told', async () => {
    const discs = service();
    await discs.status();
    await discs.read(0);
    for (let i = 0; i < 100 && (await discs.status()).reads[0]?.state === 'reading'; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await discs.status()).reads[0]?.state).toBe('done');
    // Another disc goes in, without Manelly: the cached list still shows the old one until asked again.
    await insert('series');
    expect((await discs.status()).drives[0]?.disc).toBe('FINDET_NEMO');
    const fresh = await discs.status(true);
    expect(fresh.drives[0]?.disc).toBe('DARK_S1_D1');
    expect(fresh.reads).toEqual([]);
  });

  it('checks a rip before it starts', async () => {
    const discs = service();
    const refused = (request: Parameters<typeof discs.rip>[0]) => discs.rip(request).then(() => 'started', (error: Error) => error.message);
    expect(await refused({ drive: 0, folder: 'a/b', titles: [{ index: 0, fileName: 'x.mkv' }] })).toBe('«a/b» ist kein gültiger Ordnername.');
    expect(await refused({ drive: 0, folder: 'Nemo', titles: [] })).toBe('Mindestens einen Titel wählen.');
    expect(await refused({ drive: 0, folder: 'Nemo', titles: [{ index: 0, fileName: 'x.avi' }] })).toBe('«x.avi» ist kein gültiger Dateiname; er muss auf .mkv enden.');
    expect(await refused({ drive: 0, folder: 'Nemo', titles: [{ index: 0, fileName: 'x.mkv' }, { index: 1, fileName: 'X.mkv' }] })).toBe('«X.mkv» kommt zweimal vor.');
    expect(await refused({ drive: 7, folder: 'Nemo', titles: [{ index: 0, fileName: 'x.mkv' }] })).toBe('Laufwerk 7 gibt es nicht.');
    await mkdir(path.join(target, 'Nemo'));
    await writeFile(path.join(target, 'Nemo', 'x.mkv'), 'da');
    expect(await refused({ drive: 0, folder: 'Nemo', titles: [{ index: 0, fileName: 'x.mkv' }] })).toBe('«Nemo/x.mkv» gibt es im Entpack-Ordner schon.');

    // The size MakeMKV named when it read the disc must fit.
    await discs.read(0);
    for (let i = 0; i < 100 && (await discs.status()).reads[0]?.state === 'reading'; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    free = 500000;
    expect(await refused({ drive: 0, folder: 'Nemo', titles: [{ index: 0, fileName: 'y.mkv' }] })).toMatch(/^Zu wenig Platz im Entpack-Ordner: braucht etwa .+, frei sind .+\.$/);

    await insert(null);
    // A fresh drive list after the cache time.
    await new Promise((resolve) => setTimeout(resolve, 3100));
    expect(await refused({ drive: 0, folder: 'Nemo', titles: [{ index: 0, fileName: 'y.mkv' }] })).toBe('Im Laufwerk liegt keine Disc.');
    expect(await service(null).rip({ drive: 0, folder: 'Nemo', titles: [{ index: 0, fileName: 'y.mkv' }] }).catch((error: Error) => error.message)).toBe(
      'MakeMKV fehlt auf dem Server – zuerst installieren (makemkv.com).',
    );
  }, 10_000);

  it('says what MakeMKV said when it fails, and cancels', async () => {
    await insert('movie', { fail: true });
    const discs = service();
    await discs.rip({ drive: 0, folder: 'Nemo', titles: [{ index: 0, fileName: 'Nemo.mkv' }], eject: false });
    await discs.idle();
    expect((await discs.status()).rips[0]).toMatchObject({ state: 'failed', error: expect.stringContaining('Failed to save title 0 to file') });
    expect(ejected).toEqual([]);

    await insert('movie', { noFile: true });
    await discs.rip({ drive: 0, folder: 'Nemo', titles: [{ index: 0, fileName: 'Nemo.mkv' }] });
    await discs.idle();
    expect((await discs.status()).rips[0]?.error).toBe('MakeMKV hat Titel 1 nicht gespeichert: Copy complete. 0 titles saved, 1 failed.');

    await insert('movie', { ripMs: 5000 });
    const slow = await discs.rip({ drive: 0, folder: 'Langsam', titles: [{ index: 0, fileName: 'Langsam.mkv' }] });
    for (let i = 0; i < 100 && (await discs.status()).rips[0]?.state !== 'running'; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(discs.rip({ drive: 0, folder: 'Noch', titles: [{ index: 1, fileName: 'Noch.mkv' }] })).rejects.toThrow('Von dieser Disc wird schon gerippt.');
    expect(discs.running()?.id).toBe(slow.id);
    discs.cancel(slow.id);
    await discs.idle();
    expect((await discs.status()).rips[0]).toMatchObject({ state: 'canceled' });
    expect((await readdir(target)).filter((name) => name.startsWith('.'))).toEqual([]);
    expect(ejected).toEqual([]);
  });

  it('rips a new disc by itself in the automatic mode, once', async () => {
    const discs = service();
    await discs.tick();
    expect((await discs.status()).rips).toEqual([]);
    await discs.setSettings({ auto: true, eject: true });
    await discs.tick();
    await discs.idle();
    const [rip] = (await discs.status()).rips;
    expect(rip).toMatchObject({ auto: true, folder: 'Findet Nemo', state: 'done' });
    expect(rip?.titles.map((title) => [title.index, title.fileName])).toEqual([[0, 'Findet Nemo.mkv']]);
    expect(ejected).toEqual(['/dev/sr0']);

    // The same disc again, after it was out: a second folder.
    await new Promise((resolve) => setTimeout(resolve, 3100));
    await discs.tick();
    await insert('movie');
    await new Promise((resolve) => setTimeout(resolve, 3100));
    await discs.tick();
    await discs.idle();
    expect((await discs.status()).rips.map((entry) => entry.folder)).toEqual(['Findet Nemo (2)', 'Findet Nemo']);
    expect(JSON.parse(await readFile(statePath, 'utf8')).disc).toBeNull();
  }, 15_000);
});
