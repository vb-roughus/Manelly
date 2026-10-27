import { useEffect } from 'react';
import { Download } from 'lucide-react';
import { JDownloaderForm } from '../components/JDownloaderForm';
import { SettingsSection } from '../components/SettingsSection';

export function JDownloaderPage() {
  useEffect(() => {
    document.title = 'JDownloader · Server · Manelly';
  }, []);

  return (
    <div className="mx-auto max-w-3xl">
      <header>
        <p className="text-sm font-medium text-accent">Server</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">JDownloader</h1>
        <p className="mt-1 text-sm text-ink-2">
          JDownloader auf dem Jellyfin-Server, über den Agent: Downloads im Dashboard sehen und steuern, und bremsen, solange jemand streamt.
        </p>
      </header>

      <SettingsSection icon={Download} title="Einstellungen" description="Ob Manelly JDownloader zeigt, wo der Agent ihn erreicht, und was beim Streamen passiert.">
        <JDownloaderForm />
      </SettingsSection>
    </div>
  );
}
