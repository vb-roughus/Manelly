import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentUpdateResult } from '@manelly/shared';
import { dataDirFrom, loadConfig } from './config.js';
import { createRecorder } from './history.js';
import { createJDownloader } from './jdownloader.js';
import { AGENT_VERSION, createMediaNotifier, createNotifier } from './jellyfin.js';
import { createJobQueue } from './jobs.js';
import { createMover } from './moves.js';
import { createOriginals } from './originals.js';
import { conversionProcesses } from './convert.js';
import { createCopyLimiter } from './copyLimit.js';
import { createNetworkMonitor, defaultSource } from './network.js';
import { createResourceMonitor, defaultResourceSource } from './resources.js';
import { createGate, createSettingsStore } from './schedule.js';
import { createAgentServer } from './server.js';
import { discoverTools, type Tools } from './tools.js';
import { createDrives, CREDENTIALS_HINT } from './drives.js';
import { createUpdater } from './updater.js';

const AGENT_DIR = fileURLToPath(new URL('..', import.meta.url));

const dataDir = dataDirFrom();
const logFile = join(dataDir, 'agent.log');
const LOG_LIMIT_BYTES = 5 * 1024 * 1024;

/** Console and agent.log – when started by the autostart, nobody sees the console. */
function write(text: string) {
  console.log(text);
  try {
    mkdirSync(dataDir, { recursive: true });
    if ((statSync(logFile, { throwIfNoEntry: false })?.size ?? 0) > LOG_LIMIT_BYTES) renameSync(logFile, `${logFile}.1`);
    appendFileSync(logFile, `${text}\n`);
  } catch {
    // Logging must never stop the agent.
  }
}

function log(message: string) {
  write(`[${new Date().toLocaleString('de-CH')}] ${message}`);
}

const { config, path: configPath, created } = await loadConfig(dataDir);

let tools: Tools = await discoverTools({ configured: config.tools, agentDir: AGENT_DIR });
async function currentTools(refresh = false): Promise<Tools> {
  const missing = !tools.ffmpeg.path || !tools.mkvmerge.path || !tools.doviTool.path;
  if (refresh || missing) tools = await discoverTools({ configured: config.tools, agentDir: AGENT_DIR });
  return tools;
}

const settings = await createSettingsStore(dataDir);
// The scheduled task passes --autostart; started by hand, the agent runs in a console window.
const autostart = process.argv.includes('--autostart');
// Started without a logon, the agent connects the user's network drives (Z:) itself when a path needs one – with
// the login Manelly handed over for their server.
const drives = createDrives({ log, credentials: { get: () => settings.get().networkCredentials, set: settings.setNetworkCredentials } });
const access = { prepare: drives.prepare, networkHint: process.platform === 'win32' ? CREDENTIALS_HINT : null };
void drives.connectAll();
// The originals that conversions in the work folder replaced and kept there.
const originals = await createOriginals(dataDir);
// Copying to and from the work folder, and into the libraries, leaves the storage enough for streams, as set in Manelly.
const copyLimiter = createCopyLimiter({ settings });
const queue = await createJobQueue({
  dataDir,
  roots: config.roots,
  tools: () => currentTools(),
  gate: createGate({ settings: settings.get }),
  notify: createNotifier(() => settings.get().jellyfin, { log }),
  access,
  workFolder: () => settings.get().work,
  copyLimit: copyLimiter.current,
  originals,
  log,
});
// From the extraction folder into the libraries; Jellyfin hears about the new folders right away.
const mover = createMover({ copyLimit: copyLimiter.current, notify: createMediaNotifier(() => settings.get().jellyfin, { log }), log });
// Measures only the interfaces picked in Manelly, and only while somebody looks.
const network = createNetworkMonitor({ source: defaultSource(), selection: () => settings.get().network, log });
// CPU and GPU, with the shares of Jellyfin's FFmpeg and of the agent's own conversion; also only while somebody looks.
const resources = createResourceMonitor({ source: defaultResourceSource(), ownProcesses: () => conversionProcesses, log });
// JDownloader on this machine: read and controlled from Manelly, held back while somebody streams.
const jdownloader = createJDownloader({ settings, log });
// Load and streams on disk, around the clock while switched on in Manelly; keeps both monitors measuring.
const recorder = createRecorder({ dir: join(dataDir, 'history'), settings, resources, network, log });
// scripts/run-agent.ps1 starts the agent again when it ends with one of these codes; it sets the variable.
const RESTART_EXIT = 75;
const UPDATE_EXIT = 76;
const processInfo = {
  pid: process.pid,
  startedAt: new Date().toISOString(),
  node: process.version,
  execPath: process.execPath,
  autostart,
  port: config.port,
  restartable: process.env.MANELLY_AGENT_SUPERVISED === '1',
};

/** What run-agent.ps1 wrote about its last update. */
async function lastUpdate(): Promise<AgentUpdateResult | null> {
  try {
    const stored = JSON.parse((await readFile(join(dataDir, 'update.json'), 'utf8')).replace(/^\uFEFF/, '')) as Partial<AgentUpdateResult>;
    if (typeof stored.at !== 'string' || typeof stored.ok !== 'boolean') return null;
    return { at: stored.at, ok: stored.ok, upToDate: stored.upToDate === true, from: stored.from ?? null, to: stored.to ?? null, message: String(stored.message ?? '') };
  } catch {
    return null;
  }
}
// Looks for a newer version, pulls and builds while the agent keeps working; run-agent.ps1 then starts the new build.
const updater = createUpdater({
  script: join(AGENT_DIR, '..', 'scripts', 'update.mjs'),
  reportFile: join(dataDir, 'update.json'),
  target: 'agent',
  // A conversion that started while it built (from the schedule) finishes first, unless the update was forced.
  onRestart: (force) => {
    const busy = force ? null : queue.running();
    const moving = force ? null : mover.running();
    if (!busy && !moving) return shutdown('Update fertig, Neustart', RESTART_EXIT);
    log(`Update fertig – Neustart, sobald ${busy ? `die Umwandlung ${busy.source}` : `das Verschieben nach ${moving!.target}`} fertig ist.`);
    void Promise.all([queue.idle(), mover.idle()]).then(() => shutdown('Update fertig, Neustart nach Umwandlung und Verschieben', RESTART_EXIT));
  },
  log,
});
const server = createAgentServer({
  token: config.token,
  roots: config.roots,
  queue,
  settings,
  network,
  resources,
  jdownloader,
  recorder,
  tools: currentTools,
  process: async () => ({ ...processInfo, update: updater.progress(), lastUpdate: await lastUpdate() }),
  updater,
  access,
  drives,
  originals,
  mover,
  onExit: (how) =>
    how === 'stop'
      ? shutdown('Beenden angefordert (Manelly oder Installationsskript)')
      : shutdown(how === 'update' ? 'Update angefordert' : 'Neustart angefordert', how === 'update' ? UPDATE_EXIT : RESTART_EXIT),
});

/** Who holds the port: an agent (and which version), or another program. */
async function portHolder(): Promise<string> {
  try {
    const health = (await (await fetch(`http://127.0.0.1:${config.port}/api/health`, { signal: AbortSignal.timeout(2000) })).json()) as { status?: string; version?: string };
    if (health.status === 'ok') return health.version ? `einen Manelly-Agent (Version ${health.version})` : 'einen älteren Manelly-Agent';
  } catch {
    // Not an agent, or not answering.
  }
  return 'ein anderes Programm';
}

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EADDRINUSE') {
    log(error.message);
    process.exit(1);
  }
  void portHolder().then((holder) => {
    log(
      `Port ${config.port} ist schon belegt, durch ${holder}. Einen laufenden Agent beendest du in Manelly unter Server → Agent ` +
        'oder mit scripts\\start-agent.cmd -Install (als Administrator), das ihn ersetzt.',
    );
    process.exit(1);
  });
});

server.listen(config.port, config.host, () => {
  const lines = [
    `Manelly-Agent ${AGENT_VERSION} läuft auf Port ${config.port} (Prozess ${process.pid}${autostart ? ', Autostart' : ''}).`,
    '',
    'In Manelly unter Server → Agent eintragen:',
    `  Adresse:   http://${hostname()}:${config.port}`,
    `  Schlüssel: ${config.token}`,
    '',
    'Werkzeuge:',
    ...Object.entries(tools).map(([name, tool]) => `  ${tool.path ? '✓' : '✗'} ${name.padEnd(9)} ${tool.path ?? 'nicht gefunden'}`),
    config.roots.length ? `Freigegebene Ordner: ${config.roots.join(', ')}` : 'Freigegebene Ordner: alle, die Manelly nennt (einschränken mit "roots" in der Konfiguration)',
    `Konfiguration: ${configPath}${created ? ' (neu angelegt)' : ''}`,
  ];
  log(lines.join('\n'));
});

let stopping = false;

/** A running conversion pauses and continues with the next start. */
function shutdown(reason: string, code = 0) {
  if (stopping) return;
  stopping = true;
  log(`${reason} – der Agent beendet sich …`);
  server.close();
  network.stop();
  resources.stop();
  jdownloader.stop();
  recorder.stop();
  // Exit code 0: the autostart counts this as a normal end and does not start the agent again;
  // run-agent.ps1 starts it again for the restart codes.
  void queue.stop().then(() => process.exit(code));
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => shutdown(`${signal} empfangen`));
