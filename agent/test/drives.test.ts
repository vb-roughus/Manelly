import { describe, expect, it } from 'vitest';
import { createDrives, CREDENTIALS_HINT, describeNetError, parseMappings, serverOf, type CommandRunner, type CredentialStore, type NetworkCredential } from '../src/drives.js';

// What `reg query HKCU\Network /s` prints on a German Windows.
const REG_OUTPUT = `
HKEY_CURRENT_USER\\Network\\Y
    ConnectionType    REG_DWORD    0x1
    RemotePath    REG_SZ    \\\\nas\\serien
    UserName    REG_SZ    

HKEY_CURRENT_USER\\Network\\z
    RemotePath    REG_SZ    \\\\nas\\filme
`;

// What Windows PowerShell writes to stderr when another program starts it, even when all goes well.
const PROGRESS_CLIXML =
  '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T></TN><MS><I64 N="SourceId">1</I64><PR N="Record"><AV>Preparing modules for first use.</AV><AI>0</AI><Nil /><PI>-1</PI><PC>-1</PC><T>Completed</T><SR>-1</SR><SD> </SD></PR></MS></Obj></Objs>';

/** Windows as the agent sees it without a logon: drives missing until net use (or a login from Manelly) connects them. */
function fakeWindows(netUse: (letter: string) => { code: number; output: string } = () => ({ code: 0, output: 'Der Befehl wurde erfolgreich ausgeführt.' })) {
  const present = new Set<string>(['C:\\']);
  const calls: string[] = [];
  /** What PowerShell got on stdin, decoded. */
  const inputs: Array<Record<string, string | null>> = [];
  let saved: NetworkCredential[] = [];
  const credentials: CredentialStore = { get: () => saved, set: async (next) => void (saved = next) };
  const dpapi = { works: true };
  const run: CommandRunner = async (command, args, input) => {
    calls.push([command, ...args].join(' '));
    if (command === 'reg') return { code: 0, stdout: REG_OUTPUT, stderr: '' };
    if (command.endsWith('powershell.exe')) {
      const script = Buffer.from(args.at(-1)!, 'base64').toString('utf16le');
      const given = JSON.parse(Buffer.from(input!, 'base64').toString('utf8')) as Record<string, string | null>;
      inputs.push(given);
      const answer = (stdout: string, code = 0) => ({ code, stdout, stderr: PROGRESS_CLIXML });
      // The script reports its own errors on stdout.
      if (!dpapi.works) return answer('ERROR: Der Schlüsselsatz ist nicht vorhanden.', 1);
      // DPAPI stand-in: only this "computer" reads it back.
      if (script.includes('ProtectedData]::Protect(')) return answer(Buffer.from(`dpapi:${given.password}`).toString('base64'));
      const password = Buffer.from(given.secret!, 'base64').toString('utf8');
      if (given.username !== 'rolf' || password !== 'dpapi:Grüezi 123') return answer('86');
      present.add(`${given.local ?? given.remote}\\`);
      return answer('0');
    }
    const result = netUse(args[1]!);
    if (result.code === 0) present.add(`${args[1]}\\`);
    // net use takes a moment; a second request meanwhile must not start another.
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Its errors go to stderr.
    return result.code === 0 ? { code: 0, stdout: result.output, stderr: '' } : { code: result.code, stdout: '', stderr: result.output };
  };
  return { present, calls, inputs, dpapi, credentials, saved: () => saved, options: { platform: 'win32' as const, run, exists: async (root: string) => present.has(root), credentials } };
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
      needsLogin: true,
    });
    expect(describeNetError('System error 53 has occurred.')).toEqual({ reason: 'das NAS ist nicht erreichbar (Netzwerkpfad nicht gefunden)', needsLogin: false });
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

  it('says why a drive cannot be connected, and what helps', async () => {
    const world = fakeWindows(() => ({ code: 2, output: 'Systemfehler 1312 aufgetreten.' }));
    const drives = createDrives(world.options);
    const hint = CREDENTIALS_HINT.replace('das NAS', '\\\\nas');
    expect(hint).toBe('In Manelly unter Server → Agent bei den Netzlaufwerken Benutzername und Passwort für \\\\nas hinterlegen.');
    expect(await drives.prepare('Z:\\Filme\\Film.mkv')).toBe(
      `Das Netzlaufwerk Z: (\\\\nas\\filme) ist für den Agent nicht erreichbar: ohne Anmeldung keine Anmeldedaten für das Netzwerk. ${hint}`,
    );
    expect(await drives.prepare('X:\\Film.mkv')).toMatch(/^Das Laufwerk X: gibt es für den Agent nicht/);
    expect(await drives.list()).toEqual([
      { letter: 'Y:', remote: '\\\\nas\\serien', connected: false, error: null, username: null },
      { letter: 'Z:', remote: '\\\\nas\\filme', connected: false, error: `ohne Anmeldung keine Anmeldedaten für das Netzwerk. ${hint}`, username: null },
    ]);
  });

  it('keeps the login from Manelly encrypted and connects the drives of its server with it', async () => {
    const world = fakeWindows(() => ({ code: 2, output: 'Systemfehler 1312 aufgetreten.' }));
    const drives = createDrives(world.options);
    await drives.connectAll();
    const listed = await drives.setCredential('\\\\NAS', 'rolf', 'Grüezi 123');
    expect(listed).toEqual([
      { letter: 'Y:', remote: '\\\\nas\\serien', connected: true, error: null, username: 'rolf' },
      { letter: 'Z:', remote: '\\\\nas\\filme', connected: true, error: null, username: 'rolf' },
    ]);
    // Only the encrypted password is kept; the plain one only ever went through stdin, never on a command line.
    expect(world.saved()).toEqual([{ server: '\\\\NAS', username: 'rolf', secret: Buffer.from('dpapi:Grüezi 123').toString('base64') }]);
    expect(world.calls.some((call) => call.includes('Grüezi'))).toBe(false);
    expect(world.inputs.slice(1)).toEqual([
      { local: 'Y:', remote: '\\\\nas\\serien', username: 'rolf', secret: world.saved()[0]!.secret },
      { local: 'Z:', remote: '\\\\nas\\filme', username: 'rolf', secret: world.saved()[0]!.secret },
    ]);
  });

  it('connects a share without a letter with the login, and says when Windows refuses it', async () => {
    const world = fakeWindows();
    const drives = createDrives(world.options);
    // Without a login, a share path is left to Windows.
    expect(await drives.prepare('\\\\nas\\filme\\Film.mkv')).toBeNull();
    expect(world.inputs).toEqual([]);

    await drives.setCredential('\\\\nas', 'rolf', 'falsch');
    expect(await drives.prepare('\\\\nas\\filme\\Film.mkv')).toBe('Die Freigabe \\\\nas\\filme ist für den Agent nicht erreichbar: Benutzername oder Passwort falsch.');
    await drives.setCredential('\\\\nas', 'rolf', 'Grüezi 123');
    expect(await drives.prepare('\\\\nas\\filme\\Film.mkv')).toBeNull();
    expect(world.inputs.at(-1)).toMatchObject({ local: null, remote: '\\\\nas\\filme' });
    // Another server has no login of its own.
    expect(await drives.prepare('\\\\backup\\filme\\Film.mkv')).toBeNull();

    expect((await drives.removeCredential('\\\\nas')).map((drive) => drive.username)).toEqual([null, null]);
    expect(world.saved()).toEqual([]);
  });

  it('says why Windows could not encrypt the password, and keeps nothing then', async () => {
    const world = fakeWindows();
    world.dpapi.works = false;
    await expect(createDrives(world.options).setCredential('\\\\nas', 'rolf', 'Grüezi 123')).rejects.toThrow(
      'Windows konnte das Passwort nicht verschlüsseln: Der Schlüsselsatz ist nicht vorhanden.',
    );
    expect(world.saved()).toEqual([]);
  });

  it('takes logins on Windows only', async () => {
    const drives = createDrives({ ...fakeWindows().options, platform: 'linux' });
    await expect(drives.setCredential('\\\\nas', 'rolf', 'x')).rejects.toThrow('Netzlaufwerke verbindet der Agent nur unter Windows.');
  });

  it('finds the server of a network path', () => {
    expect(serverOf('\\\\nas\\filme\\Film.mkv')).toBe('\\\\nas');
    expect(serverOf('\\\\192.168.1.20')).toBe('\\\\192.168.1.20');
    expect(serverOf('Z:\\Filme')).toBeNull();
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
