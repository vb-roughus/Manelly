import { ConnectionForm } from './ConnectionForm';

/** First-run onboarding: shown on the dashboard until a Jellyfin connection exists. */
export function SetupPanel() {
  return (
    <section
      aria-labelledby="setup-heading"
      className="mx-auto max-w-2xl rounded-2xl border border-line bg-card p-5 shadow-sm shadow-black/5 sm:p-7"
    >
      <img src="/favicon.svg" alt="" className="size-11" />
      <h2 id="setup-heading" className="mt-4 text-xl font-semibold tracking-tight">
        Willkommen bei Manelly
      </h2>
      <p className="mt-1 mb-6 text-sm text-ink-2">
        Verbinde Manelly mit deinem Jellyfin-Server, um die laufenden Streams zu sehen. Du kannst die Verbindung später
        jederzeit in den Einstellungen ändern.
      </p>
      <ConnectionForm />
    </section>
  );
}
