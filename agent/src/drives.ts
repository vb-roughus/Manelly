import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { NetworkDrive } from '@manelly/shared';
import { AgentError } from './errors.js';

/** Output and exit code of a command, with what it reads from stdin; injectable for tests. */
export type CommandRunner = (command: string, args: string[], input?: string) => Promise<{ code: number | null; output: string }>;

const runCommand: CommandRunner = (command, args, input) =>
  new Promise((resolve) => {
    // Without input, stdin is closed: net use must not wait for a password nobody can type.
    const child = spawn(command, args, { windowsHide: true, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], timeout: 30_000 });
    let output = '';
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
    child.on('error', (error) => resolve({ code: null, output: error.message }));
    child.on('close', (code) => resolve({ code, output }));
    if (input !== undefined) child.stdin?.end(input);
  });

/** A login for the shares of one server, as Manelly handed it over. */
export interface NetworkCredential {
  /** "\\nas" */
  server: string;
  username: string;
  /** The password, encrypted with Windows DPAPI for this computer (base64): useless anywhere else. */
  secret: string;
}

/** Where the agent keeps the logins (its settings). */
export interface CredentialStore {
  get(): NetworkCredential[];
  set(credentials: NetworkCredential[]): Promise<void>;
}

/** The network drives Windows keeps for this user (HKCU\Network\<letter>\RemotePath), from `reg query /s`. */
export function parseMappings(output: string): Array<{ letter: string; remote: string }> {
  const mappings: Array<{ letter: string; remote: string }> = [];
  let letter: string | null = null;
  for (const line of output.split(/\r?\n/)) {
    const key = line.match(/^HKEY_CURRENT_USER\\Network\\([A-Za-z])\s*$/i);
    if (key) {
      letter = `${key[1]!.toUpperCase()}:`;
      continue;
    }
    const value = line.match(/^\s+RemotePath\s+REG_(?:EXPAND_)?SZ\s+(\S.*?)\s*$/i);
    if (value && letter) mappings.push({ letter, remote: value[1]! });
  }
  return mappings;
}

/** "\\nas\filme\Film.mkv" → "\\nas"; null for anything but a network path. */
export function serverOf(file: string): string | null {
  return file.match(/^(\\\\[^\\/]+)(?:[\\/]|$)/)?.[1] ?? null;
}

const sameServer = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// Windows' error numbers, from net use ("System error 5 has occurred." / "Systemfehler 5 aufgetreten.") or the API.
const NET_ERRORS: Record<number, string> = {
  5: 'Zugriff verweigert',
  53: 'das NAS ist nicht erreichbar (Netzwerkpfad nicht gefunden)',
  67: 'die Freigabe gibt es nicht',
  85: 'der Laufwerksbuchstabe ist schon belegt',
  86: 'Benutzername oder Passwort falsch',
  1203: 'das NAS ist nicht erreichbar (Netzwerkpfad nicht gefunden)',
  1219: 'mit anderen Anmeldedaten schon verbunden',
  1244: 'ohne Anmeldung keine Anmeldedaten für das Netzwerk',
  1312: 'ohne Anmeldung keine Anmeldedaten für das Netzwerk',
  1326: 'Benutzername oder Passwort falsch',
  1330: 'das Passwort ist abgelaufen',
  1331: 'das Konto ist deaktiviert',
  1385: 'ohne Anmeldung keine Anmeldedaten für das Netzwerk',
  1909: 'das Konto ist gesperrt',
  2202: 'der Benutzername ist ungültig',
};

/** Errors that a login for the server fixes: the agent has no credentials for the network, or the wrong ones. */
const NEEDS_LOGIN = new Set([5, 86, 1244, 1312, 1326, 1385]);

export function describeNetCode(code: number): { reason: string; needsLogin: boolean } {
  return { reason: NET_ERRORS[code] ?? `Windows-Fehler ${code}`, needsLogin: NEEDS_LOGIN.has(code) };
}

export function describeNetError(output: string): { reason: string; needsLogin: boolean } {
  const code = Number(output.match(/(?:error|fehler|erreur|errore)\s+(\d{1,5})/i)?.[1] ?? NaN);
  // Unknown numbers: Windows' own first line, which names the number.
  if (!NET_ERRORS[code]) return { reason: output.trim().split(/\r?\n/).find((line) => line.trim())?.trim() || 'unbekannter Fehler', needsLogin: NEEDS_LOGIN.has(code) };
  return describeNetCode(code);
}

export const CREDENTIALS_HINT = 'In Manelly unter Server → Agent bei den Netzlaufwerken Benutzername und Passwort für das NAS hinterlegen.';

// The scripts get everything through stdin, as base64 of UTF-8 JSON: nothing secret on a command line, and umlauts
// in passwords survive whatever code page the console has.
const READ_INPUT = `$ErrorActionPreference = 'Stop'
$in = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())) | ConvertFrom-Json
Add-Type -AssemblyName System.Security`;

/** Encrypts with DPAPI for this computer: any account here may decrypt it – also the autostart without logon. */
const PROTECT_SCRIPT = `${READ_INPUT}
$bytes = [Text.Encoding]::UTF8.GetBytes($in.password)
[Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'LocalMachine')))`;

/** Connects a share – to a drive letter, or without one – with the login; prints Windows' result (0 = connected). */
const CONNECT_SCRIPT = `${READ_INPUT}
$password = [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($in.secret), $null, 'LocalMachine'))
Add-Type -Namespace Manelly -Name Net -MemberDefinition '
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class Resource { public int Scope; public int Type; public int DisplayType; public int Usage; public string LocalName; public string RemoteName; public string Comment; public string Provider; }
  [DllImport("mpr.dll", CharSet = CharSet.Unicode)]
  public static extern int WNetAddConnection2(Resource resource, string password, string username, int flags);'
$resource = New-Object Manelly.Net+Resource
$resource.Type = 1
$resource.LocalName = $in.local
$resource.RemoteName = $in.remote
[Console]::Out.Write([Manelly.Net]::WNetAddConnection2($resource, $password, $in.username, 0))`;

// The autostart may run without the PATH of an interactive session.
const POWERSHELL = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/**
 * Network drives on Windows. Started without a logon (the autostart), the agent does not see the drive letters the
 * user connected (Z:); it connects them in its own session, the way Windows keeps them for the user – with the login
 * Manelly handed over for their server, if any. Only the drives and shares a path from Manelly needs, and those
 * Windows knows – nothing is searched.
 */
export function createDrives(options: {
  platform?: NodeJS.Platform;
  run?: CommandRunner;
  /** Whether a drive root like "Z:\" or a share is there; injectable for tests. */
  exists?: (root: string) => Promise<boolean>;
  credentials?: CredentialStore;
  log?: (message: string) => void;
} = {}) {
  const { platform = process.platform, run = runCommand, log = () => {} } = options;
  const exists = options.exists ?? ((root: string) => stat(root).then(() => true, () => false));
  const credentials = options.credentials ?? { get: () => [], set: async () => {} };
  const known = new Map<string, NetworkDrive>();
  const connecting = new Map<string, Promise<string | null>>();
  // Manelly asks for the status often; a drive whose NAS is off can take seconds to answer.
  let listed: { at: number; drives: Promise<NetworkDrive[]> } | null = null;

  async function mappings() {
    const { code, output } = await run('reg', ['query', 'HKCU\\Network', '/s']);
    return code === 0 ? parseMappings(output) : [];
  }

  const loginFor = (remote: string) => {
    const server = serverOf(remote);
    return server ? (credentials.get().find((credential) => sameServer(credential.server, server)) ?? null) : null;
  };

  async function powershell(script: string, input: object) {
    const encoded = Buffer.from(JSON.stringify(input), 'utf8').toString('base64');
    return run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], encoded);
  }

  /** Connects a share to a letter, or without one (local null); resolves to why it failed, or null. */
  async function connect(local: string | null, remote: string): Promise<string | null> {
    const login = loginFor(remote);
    let failure: { reason: string; needsLogin: boolean } | null;
    if (login) {
      const { code, output } = await powershell(CONNECT_SCRIPT, { local, remote, username: login.username, secret: login.secret });
      const result = code === 0 && /^\d+$/.test(output.trim()) ? Number(output.trim()) : null;
      failure =
        result === 0
          ? null
          : result !== null
            ? describeNetCode(result)
            : { reason: `Windows meldet: ${output.trim().split(/\r?\n/)[0] || `PowerShell endete mit ${code}`}`, needsLogin: false };
    } else {
      const { code, output } = await run('net', ['use', ...(local ? [local] : []), remote, '/persistent:no']);
      failure = code === 0 ? null : describeNetError(output);
    }
    listed = null;
    if (!failure || (local && (await exists(`${local}\\`)))) return null;
    const server = serverOf(remote) ?? remote;
    // With a login the hint does not help: it is that login Windows refused.
    return `${failure.reason}.${failure.needsLogin && !login ? ` ${CREDENTIALS_HINT.replace('das NAS', server)}` : ''}`;
  }

  /** Connects a drive once, also when several paths ask at the same time. */
  function connectDrive(letter: string, remote: string): Promise<string | null> {
    const running = connecting.get(letter);
    if (running) return running;
    const attempt = connect(letter, remote)
      .then((error) => {
        known.set(letter, { letter, remote, connected: !error, error, username: loginFor(remote)?.username ?? null });
        log(error ? `Netzlaufwerk ${letter} (${remote}) nicht verbunden: ${error}` : `Netzlaufwerk ${letter} (${remote}) verbunden.`);
        return error;
      })
      .finally(() => connecting.delete(letter));
    connecting.set(letter, attempt);
    return attempt;
  }

  /** A share without a letter (\\nas\filme), once at a time; only with a login – without one, Windows tries on its own. */
  function connectShare(share: string): Promise<string | null> {
    const key = share.toLowerCase();
    const running = connecting.get(key);
    if (running) return running;
    const attempt = connect(null, share)
      .then((error) => {
        log(error ? `Freigabe ${share} nicht verbunden: ${error}` : `Freigabe ${share} verbunden.`);
        return error;
      })
      .finally(() => connecting.delete(key));
    connecting.set(key, attempt);
    return attempt;
  }

  /** The drives of a server again, e.g. with a new login. */
  async function reconnect(server: string) {
    known.clear();
    listed = null;
    for (const { letter, remote } of await mappings()) {
      if (serverOf(remote) && sameServer(serverOf(remote)!, server) && !(await exists(`${letter}\\`))) await connectDrive(letter, remote);
    }
  }

  function requireWindows() {
    if (platform !== 'win32') throw new AgentError(400, 'Netzlaufwerke verbindet der Agent nur unter Windows.');
  }

  /** The user's network drives, whether the agent reaches them and with which login; empty outside Windows. */
  function list(): Promise<NetworkDrive[]> {
    if (platform !== 'win32') return Promise.resolve([]);
    if (listed && Date.now() - listed.at < 15_000) return listed.drives;
    const drives = (async () => {
      const result: NetworkDrive[] = [];
      for (const { letter, remote } of await mappings()) {
        const username = loginFor(remote)?.username ?? null;
        const connected = await exists(`${letter}\\`);
        const before = known.get(letter);
        result.push(connected || !before ? { letter, remote, connected, error: null, username } : { ...before, username });
      }
      return result;
    })();
    listed = { at: Date.now(), drives };
    return drives;
  }

  return {
    list,

    /** At the start: every network drive of the user, so they are there before the first conversion. */
    async connectAll(): Promise<void> {
      if (platform !== 'win32') return;
      for (const { letter, remote } of await mappings()) {
        if (!(await exists(`${letter}\\`))) await connectDrive(letter, remote);
      }
    },

    /**
     * Before a path is used: connects its drive when it is a network drive that is missing in this session, or its
     * share when Manelly handed over a login for the server. Resolves to why the path cannot be reached, or null.
     */
    async prepare(file: string): Promise<string | null> {
      if (platform !== 'win32') return null;
      const share = file.match(/^(\\\\[^\\/]+[\\/][^\\/]+)/)?.[1]?.replace(/\//g, '\\');
      if (share) {
        if (!loginFor(share) || (await exists(`${share}\\`))) return null;
        const error = await connectShare(share);
        return error ? `Die Freigabe ${share} ist für den Agent nicht erreichbar: ${error}` : null;
      }
      const letter = file.match(/^([A-Za-z]:)[\\/]/)?.[1]?.toUpperCase();
      if (!letter || (await exists(`${letter}\\`))) return null;
      const mapping = (await mappings()).find((candidate) => candidate.letter === letter);
      if (!mapping) return `Das Laufwerk ${letter} gibt es für den Agent nicht. Ist es ein Netzlaufwerk, das erst bei der Anmeldung verbunden wird?`;
      const error = await connectDrive(letter, mapping.remote);
      return error ? `Das Netzlaufwerk ${letter} (${mapping.remote}) ist für den Agent nicht erreichbar: ${error}` : null;
    },

    /**
     * Keeps the login for a server – the password encrypted for this computer – and connects its drives with it.
     * Manelly only hands it over; it keeps nothing.
     */
    async setCredential(server: string, username: string, password: string): Promise<NetworkDrive[]> {
      requireWindows();
      const { code, output } = await powershell(PROTECT_SCRIPT, { password });
      const secret = output.trim();
      if (code !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(secret)) {
        throw new AgentError(500, `Windows konnte das Passwort nicht verschlüsseln: ${secret.split(/\r?\n/)[0] || `PowerShell endete mit ${code}`}`);
      }
      await credentials.set([...credentials.get().filter((credential) => !sameServer(credential.server, server)), { server, username, secret }]);
      log(`Anmeldedaten für ${server} (${username}) von Manelly erhalten.`);
      await reconnect(server);
      return list();
    },

    /** Forgets the login; drives connected with it stay connected until the agent restarts. */
    async removeCredential(server: string): Promise<NetworkDrive[]> {
      requireWindows();
      await credentials.set(credentials.get().filter((credential) => !sameServer(credential.server, server)));
      log(`Anmeldedaten für ${server} entfernt.`);
      known.clear();
      listed = null;
      return list();
    },
  };
}

export type Drives = ReturnType<typeof createDrives>;
