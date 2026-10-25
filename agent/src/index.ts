import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDirFrom, loadConfig } from './config.js';
import { createJobQueue } from './jobs.js';
import { createAgentServer } from './server.js';
import { discoverTools, type Tools } from './tools.js';

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

const queue = await createJobQueue({ dataDir, roots: config.roots, tools: () => currentTools(), log });
const server = createAgentServer({ token: config.token, roots: config.roots, queue, tools: currentTools });

server.on('error', (error: NodeJS.ErrnoException) => {
  log(error.code === 'EADDRINUSE' ? `Port ${config.port} ist schon belegt – läuft der Agent bereits?` : error.message);
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  const lines = [
    `Manelly-Agent läuft auf Port ${config.port}.`,
    '',
    'In Manelly unter Einstellungen → Agent eintragen:',
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

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    log(`${signal} empfangen, beende den Agent …`);
    server.close();
    void queue.stop().then(() => process.exit(0));
  });
}
