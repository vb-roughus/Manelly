import { createAgentConnection, createFileAgentSettingsStore } from './agent/connection.js';
import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createConnection } from './connection.js';
import { createLocalListener } from './clicknload/listener.js';
import { createClickNLoad, createFileClickNLoadSettings } from './clicknload/service.js';
import { createJellyfinClient } from './jellyfin/client.js';
import { createFileLinksStore } from './links.js';
import { createManellyProcess } from './manelly.js';
import { createFileSettingsStore } from './settings.js';

async function main() {
  const config = loadConfig();
  const connection = await createConnection({
    store: createFileSettingsStore(config.dataDir),
    envSettings: config.jellyfin,
    createClient: (settings) => createJellyfinClient(settings),
  });
  const agent = await createAgentConnection({ store: createFileAgentSettingsStore(config.dataDir) });
  const manelly = await createManellyProcess({
    root: config.rootDir,
    dataDir: config.dataDir,
    port: config.port,
    // The start script starts Manelly again for the restart code.
    onExit: (code) => {
      app.log.info('Neustart angefordert, fahre herunter …');
      app.close().then(() => process.exit(code), () => process.exit(code));
    },
    log: (message) => app.log.info(message),
  });
  const links = await createFileLinksStore(config.dataDir);
  const clickNLoad = await createClickNLoad({
    agent,
    settings: createFileClickNLoadSettings(config.dataDir),
    listener: (service) => createLocalListener(service),
    log: (message) => app.log.info(message),
  });
  const app = await buildApp({ config, connection, agent, manelly, links, clickNLoad, logger: { level: config.logLevel } });

  if (!connection.settings) {
    app.log.warn('Noch keine Jellyfin-Verbindung eingerichtet – das Dashboard zeigt das Einrichtungsformular.');
  } else {
    const origin = connection.source === 'ui' ? 'Einstellungen' : 'Umgebungsvariablen';
    app.log.info(`Verbinde mit Jellyfin unter ${connection.settings.url} (aus ${origin})`);
  }
  if (!config.staticDir) {
    app.log.info('Kein gebautes Frontend gefunden (web/dist) – nur die API wird ausgeliefert.');
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      app.log.info(`${signal} empfangen, fahre herunter …`);
      app.close().then(() => process.exit(0), () => process.exit(1));
    });
  }

  await app.listen({ host: config.host, port: config.port });
  await clickNLoad.start();
  const local = clickNLoad.status().local;
  if (local.error) app.log.warn(`Click'n'Load: ${local.error}`);
  else if (local.listening) app.log.info(`Click'n'Load: nimmt auf 127.0.0.1:${local.port} Links aus dem Browser dieses Rechners an`);
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`Konfigurationsfehler: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
