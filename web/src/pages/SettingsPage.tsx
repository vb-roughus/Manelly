import { useEffect } from 'react';
import { Link } from 'react-router';
import { CloudDownload, Network, Plug } from 'lucide-react';
import { ConnectionForm } from '../components/ConnectionForm';
import { NetworkInterfacesForm } from '../components/NetworkInterfacesForm';
import { SettingsSection } from '../components/SettingsSection';
import { UpdatesPanel } from '../components/Updates';
import { useAgentSettings } from '../hooks/queries';

export function SettingsPage() {
  useEffect(() => {
    document.title = 'Einstellungen · Manelly';
  }, []);
  const agentSettings = useAgentSettings();

  return (
    <div className="mx-auto max-w-3xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Einstellungen</h1>
        <p className="mt-1 text-sm text-ink-2">
          Manelly und den Agent aktualisieren, die Verbindung zu deinem Jellyfin-Server, und welche Netzwerkschnittstellen der Agent darauf
          misst. Den Agent selbst und JDownloader findest du unter{' '}
          <Link to="/server/agent" className="font-medium text-accent hover:underline">
            Server → Agent
          </Link>{' '}
          und{' '}
          <Link to="/server/jdownloader" className="font-medium text-accent hover:underline">
            Server → JDownloader
          </Link>
          .
        </p>
      </header>

      <SettingsSection id="updates" icon={CloudDownload} title="Updates" description="Manelly und den Agent auf den neuesten Stand bringen oder neu starten.">
        <UpdatesPanel />
      </SettingsSection>

      <SettingsSection icon={Plug} title="Jellyfin-Verbindung" description="Der API-Schlüssel bleibt auf dem Manelly-Server und wird nie angezeigt.">
        <ConnectionForm />
      </SettingsSection>

      {agentSettings.data?.url && (
        <SettingsSection
          id="network"
          icon={Network}
          title="Netzwerk des Jellyfin-Servers"
          description="Welche Schnittstellen das Dashboard zeigt und wofür sie da sind. Der Agent misst nur diese, und nur solange Manelly sie anzeigt oder aufzeichnet."
        >
          <NetworkInterfacesForm />
        </SettingsSection>
      )}
    </div>
  );
}
