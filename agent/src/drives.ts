import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import type { NetworkDrive } from '@manelly/shared';

/** Output and exit code of a command; injectable for tests. */
export type CommandRunner = (command: string, args: string[]) => Promise<{ code: number | null; output: string }>;

const runCommand: CommandRunner = (command, args) =>
  new Promise((resolve) => {
    // stdin closed: net use must not wait for a password nobody can type.
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
    child.on('error', (error) => resolve({ code: null, output: error.message }));
    child.on('close', (code) => resolve({ code, output }));
  });

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

// net use names Windows' error number in the language of the system: "System error 5 has occurred." / "Systemfehler 5 aufgetreten."
const NET_ERRORS: Record<number, string> = {
  5: 'Zugriff verweigert',
  53: 'das NAS ist nicht erreichbar (Netzwerkpfad nicht gefunden)',
  67: 'die Freigabe gibt es nicht',
  86: 'Benutzername oder Passwort falsch',
  1219: 'mit anderen Anmeldedaten schon verbunden',
  1244: 'ohne Anmeldung keine Anmeldedaten für das Netzwerk',
  1312: 'ohne Anmeldung keine Anmeldedaten für das Netzwerk',
  1326: 'Benutzername oder Passwort falsch',
  1385: 'ohne Anmeldung keine Anmeldedaten für das Netzwerk',
};

/** Errors that a stored password fixes: the autostart without it has no credentials for the network. */
const NEEDS_PASSWORD = new Set([5, 1244, 1312, 1326, 1385]);

export function describeNetError(output: string): { reason: string; needsPassword: boolean } {
  const code = Number(output.match(/(?:error|fehler|erreur|errore)\s+(\d{1,5})/i)?.[1] ?? NaN);
  // Unknown numbers: Windows' own first line, which names the number.
  const reason = NET_ERRORS[code] ?? (output.trim().split(/\r?\n/).find((line) => line.trim())?.trim() || 'unbekannter Fehler');
  return { reason, needsPassword: NEEDS_PASSWORD.has(code) };
}

export const PASSWORD_HINT =
  'Der Autostart ohne gespeichertes Passwort erreicht keine Netzwerkfreigaben: auf dem Server einmal scripts\\start-agent.cmd -Install -StorePassword als Administrator ausführen.';

/**
 * Network drives on Windows. Started without a logon (the autostart), the agent does not see the drive letters the
 * user connected (Z:); it connects them in its own session, the way Windows keeps them for the user. Only the
 * drives a path from Manelly needs, and those Windows knows – nothing is searched.
 */
export function createDrives(options: {
  platform?: NodeJS.Platform;
  run?: CommandRunner;
  /** Whether a drive root like "Z:\" is there; injectable for tests. */
  exists?: (root: string) => Promise<boolean>;
  /** Started by the autostart: a missing password is the likely reason when the network refuses. */
  autostart?: boolean;
  log?: (message: string) => void;
} = {}) {
  const { platform = process.platform, run = runCommand, autostart = false, log = () => {} } = options;
  const exists = options.exists ?? ((root: string) => stat(root).then(() => true, () => false));
  const known = new Map<string, NetworkDrive>();
  const connecting = new Map<string, Promise<NetworkDrive>>();
  // Manelly asks for the status often; a drive whose NAS is off can take seconds to answer.
  let listed: { at: number; drives: Promise<NetworkDrive[]> } | null = null;

  async function mappings() {
    const { code, output } = await run('reg', ['query', 'HKCU\\Network', '/s']);
    return code === 0 ? parseMappings(output) : [];
  }

  async function connect(letter: string, remote: string): Promise<NetworkDrive> {
    const { code, output } = await run('net', ['use', letter, remote, '/persistent:no']);
    const connected = code === 0 || (await exists(`${letter}\\`));
    const drive: NetworkDrive = { letter, remote, connected, error: null };
    listed = null;
    if (!connected) {
      const { reason, needsPassword } = describeNetError(output);
      drive.error = needsPassword && autostart ? `${reason}. ${PASSWORD_HINT}` : `${reason}.`;
    }
    known.set(letter, drive);
    log(connected ? `Netzlaufwerk ${letter} (${remote}) verbunden.` : `Netzlaufwerk ${letter} (${remote}) nicht verbunden: ${drive.error}`);
    return drive;
  }

  /** Connects the drive once, also when several paths ask at the same time. */
  function connectOnce(letter: string, remote: string): Promise<NetworkDrive> {
    const running = connecting.get(letter);
    if (running) return running;
    const attempt = connect(letter, remote).finally(() => connecting.delete(letter));
    connecting.set(letter, attempt);
    return attempt;
  }

  return {
    /** The user's network drives and whether the agent reaches them; empty outside Windows. */
    list(): Promise<NetworkDrive[]> {
      if (platform !== 'win32') return Promise.resolve([]);
      if (listed && Date.now() - listed.at < 15_000) return listed.drives;
      const drives = (async () => {
        const result: NetworkDrive[] = [];
        for (const { letter, remote } of await mappings()) {
          const connected = await exists(`${letter}\\`);
          result.push(connected ? { letter, remote, connected, error: null } : (known.get(letter) ?? { letter, remote, connected, error: null }));
        }
        return result;
      })();
      listed = { at: Date.now(), drives };
      return drives;
    },

    /** At the start: every network drive of the user, so they are there before the first conversion. */
    async connectAll(): Promise<void> {
      if (platform !== 'win32') return;
      for (const { letter, remote } of await mappings()) {
        if (!(await exists(`${letter}\\`))) await connectOnce(letter, remote);
      }
    },

    /**
     * Before a path is used: connects its drive when it is a network drive that is missing in this session.
     * Resolves to why the path cannot be reached, or null.
     */
    async prepare(path: string): Promise<string | null> {
      if (platform !== 'win32') return null;
      const letter = path.match(/^([A-Za-z]:)[\\/]/)?.[1]?.toUpperCase();
      if (!letter || (await exists(`${letter}\\`))) return null;
      const mapping = (await mappings()).find((candidate) => candidate.letter === letter);
      if (!mapping) return `Das Laufwerk ${letter} gibt es für den Agent nicht. Ist es ein Netzlaufwerk, das erst bei der Anmeldung verbunden wird?`;
      const drive = await connectOnce(letter, mapping.remote);
      return drive.connected ? null : `Das Netzlaufwerk ${letter} (${mapping.remote}) ist für den Agent nicht erreichbar: ${drive.error}`;
    },
  };
}

export type Drives = ReturnType<typeof createDrives>;
