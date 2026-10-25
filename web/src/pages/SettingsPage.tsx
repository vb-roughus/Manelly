import { useEffect } from 'react';
import { Plug, WandSparkles } from 'lucide-react';
import { AgentForm } from '../components/AgentForm';
import { ConnectionForm } from '../components/ConnectionForm';

export function SettingsPage() {
  useEffect(() => {
    document.title = 'Einstellungen · Manelly';
  }, []);

  return (
    <div className="mx-auto max-w-3xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Einstellungen</h1>
        <p className="mt-1 text-sm text-ink-2">Verbindung zu deinem Jellyfin-Server und zum Agent darauf.</p>
      </header>

      <section aria-labelledby="connection-heading" className="mt-6 rounded-2xl border border-line bg-card p-5 shadow-sm shadow-black/5 sm:p-6">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-accent/12 text-accent">
            <Plug className="size-4" aria-hidden />
          </span>
          <div>
            <h2 id="connection-heading" className="font-semibold">
              Jellyfin-Verbindung
            </h2>
            <p className="text-sm text-ink-2">Der API-Schlüssel bleibt auf dem Manelly-Server und wird nie angezeigt.</p>
          </div>
        </div>
        <ConnectionForm />
      </section>

      <section aria-labelledby="agent-heading" className="mt-6 rounded-2xl border border-line bg-card p-5 shadow-sm shadow-black/5 sm:p-6">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-accent/12 text-accent">
            <WandSparkles className="size-4" aria-hidden />
          </span>
          <div>
            <h2 id="agent-heading" className="font-semibold">
              Agent auf dem Jellyfin-Server
            </h2>
            <p className="text-sm text-ink-2">
              Optional: Er wandelt Dateien direkt auf dem Server um, z. B. Dolby Vision Profil 7 in Profil 8.1.
            </p>
          </div>
        </div>
        <AgentForm />
      </section>
    </div>
  );
}
