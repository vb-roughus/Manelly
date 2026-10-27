import { describe, expect, it } from 'vitest';
import { createDrives, describeNetError, parseMappings, PASSWORD_HINT, type CommandRunner } from '../src/drives.js';

// What `reg query HKCU\Network /s` prints on a German Windows.
const REG_OUTPUT = `
HKEY_CURRENT_USER\\Network\\Y
    ConnectionType    REG_DWORD    0x1
    RemotePath    REG_SZ    \\\\nas\\serien
    UserName    REG_SZ    

HKEY_CURRENT_USER\\Network\\z
    RemotePath    REG_SZ    \\\\nas\\filme
`;

/** Windows as the agent sees it without a logon: drives missing until net use connects them. */
function fakeWindows(netUse: (letter: string) => { code: number; output: string } = () => ({ code: 0, output: 'Der Befehl wurde erfolgreich ausgeführt.' })) {
  const present = new Set<string>(['C:\\']);
  const calls: string[] = [];
  const run: CommandRunner = async (command, args) => {
    calls.push([command, ...args].join(' '));
    if (command === 'reg') return { code: 0, output: REG_OUTPUT };
    const result = netUse(args[1]!);
    if (result.code === 0) present.add(`${args[1]}\\`);
    // net use takes a moment; a second request meanwhile must not start another.
    await new Promise((resolve) => setTimeout(resolve, 20));
    return result;
  };
  return { present, calls, options: { platform: 'win32' as const, run, exists: async (root: string) => present.has(root) } };
}

describe('network drives', () => {
  it('reads the drives Windows keeps for the user', () => {
    expect(parseMappings(REG_OUTPUT)).toEqual([
      { letter: 'Y:', remote: '\\\\nas\\serien' },
      { letter: 'Z:', remote: '\\\\nas\\filme' },
    ]);
  });

  it('names the reason net use gives, in any language', () => {
    expect(describeNetError('Systemfehler 1312 aufgetreten.\r\n\r\nEine angegebene Anmeldesitzung ist nicht vorhanden.')).toEqual({
      reason: 'ohne Anmeldung keine Anmeldedaten für das Netzwerk',
      needsPassword: true,
    });
    expect(describeNetError('System error 53 has occurred.')).toEqual({ reason: 'das NAS ist nicht erreichbar (Netzwerkpfad nicht gefunden)', needsPassword: false });
    expect(describeNetError('\r\nSystemfehler 1234 aufgetreten.\r\n').reason).toBe('Systemfehler 1234 aufgetreten.');
  });

  it('connects the drive a path needs, once, and leaves present drives alone', async () => {
    const world = fakeWindows();
    const drives = createDrives(world.options);
    const [first, second] = await Promise.all([drives.prepare('Z:\\Filme\\Film.mkv'), drives.prepare('z:\\Filme\\Anderer.mkv')]);
    expect([first, second]).toEqual([null, null]);
    expect(world.calls.filter((call) => call.startsWith('net'))).toEqual(['net use Z: \\\\nas\\filme /persistent:no']);
    expect(await drives.prepare('C:\\Filme\\Film.mkv')).toBeNull();
    expect(await drives.prepare('\\\\nas\\filme\\Film.mkv')).toBeNull();
    expect(world.calls.filter((call) => call.startsWith('net'))).toHaveLength(1);
  });

  it('says why a drive cannot be connected, and what helps the autostart', async () => {
    const world = fakeWindows(() => ({ code: 2, output: 'Systemfehler 1312 aufgetreten.' }));
    const drives = createDrives({ ...world.options, autostart: true });
    expect(await drives.prepare('Z:\\Filme\\Film.mkv')).toBe(
      `Das Netzlaufwerk Z: (\\\\nas\\filme) ist für den Agent nicht erreichbar: ohne Anmeldung keine Anmeldedaten für das Netzwerk. ${PASSWORD_HINT}`,
    );
    expect(await drives.prepare('X:\\Film.mkv')).toMatch(/^Das Laufwerk X: gibt es für den Agent nicht/);
    expect(await drives.list()).toEqual([
      { letter: 'Y:', remote: '\\\\nas\\serien', connected: false, error: null },
      { letter: 'Z:', remote: '\\\\nas\\filme', connected: false, error: `ohne Anmeldung keine Anmeldedaten für das Netzwerk. ${PASSWORD_HINT}` },
    ]);
  });

  it('connects every network drive at the start, and does nothing outside Windows', async () => {
    const world = fakeWindows();
    await createDrives(world.options).connectAll();
    expect(world.calls.filter((call) => call.startsWith('net'))).toEqual(['net use Y: \\\\nas\\serien /persistent:no', 'net use Z: \\\\nas\\filme /persistent:no']);

    const linux = fakeWindows();
    const drives = createDrives({ ...linux.options, platform: 'linux' });
    await drives.connectAll();
    expect(await drives.prepare('Z:\\Film.mkv')).toBeNull();
    expect(await drives.list()).toEqual([]);
    expect(linux.calls).toEqual([]);
  });
});
