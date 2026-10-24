import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createJellyfinClient } from './jellyfin/client.js';

async function main() {
  const config = loadConfig();
  const client = config.jellyfin ? createJellyfinClient(config.jellyfin) : null;
  const app = await buildApp({ config, client, logger: { level: config.logLevel } });

  if (!config.jellyfin) {
    app.log.warn('JELLYFIN_URL und/oder JELLYFIN_API_KEY fehlen – das Dashboard zeigt eine Einrichtungsanleitung.');
  } else {
    app.log.info(`Verbinde mit Jellyfin unter ${config.jellyfin.url}`);
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
