import { createAgentConnection, createFileAgentSettingsStore } from './agent/connection.js';
import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createConnection } from './connection.js';
import { createJellyfinClient } from './jellyfin/client.js';
import { createFileSettingsStore } from './settings.js';

async function main() {
  const config = loadConfig();
  const connection = await createConnection({
    store: createFileSettingsStore(config.dataDir),
    envSettings: config.jellyfin,
    createClient: (settings) => createJellyfinClient(settings),
  });
  const agent = await createAgentConnection({ store: createFileAgentSettingsStore(config.dataDir) });
  const app = await buildApp({ config, connection, agent, logger: { level: config.logLevel } });

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
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`Konfigurationsfehler: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
