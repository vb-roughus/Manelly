import { useEffect } from 'react';
import { Link } from 'react-router';
import { CloudDownload, Network, Plug } from 'lucide-react';
import { ConnectionForm } from '../components/ConnectionForm';
import { NetworkInterfacesForm } from '../components/NetworkInterfacesForm';
import { TabCard, Tabs, useTab, type TabEntry } from '../components/Tabs';
import { UpdatesPanel } from '../components/Updates';
import { useAgentSettings } from '../hooks/queries';

type Tab = 'updates' | 'jellyfin' | 'network';
const TABS: Array<TabEntry<Tab>> = [
  { id: 'updates', label: 'Updates', icon: CloudDownload },
  { id: 'jellyfin', label: 'Jellyfin-Verbindung', short: 'Jellyfin', icon: Plug },
  { id: 'network', label: 'Netzwerk', icon: Network },
];

export function SettingsPage() {
  useEffect(() => {
    document.title = 'Einstellungen · Manelly';
  }, []);
  const [tab, selectTab] = useTab(TABS);
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

      <div className="mt-6">
        <Tabs label="Einstellungen" tabs={TABS} tab={tab} onSelect={selectTab}>
          {tab === 'updates' ? (
            <TabCard description="Manelly und den Agent auf den neuesten Stand bringen oder neu starten.">
              <UpdatesPanel />
            </TabCard>
          ) : tab === 'jellyfin' ? (
            <TabCard description="Der API-Schlüssel bleibt auf dem Manelly-Server und wird nie angezeigt.">
              <ConnectionForm />
            </TabCard>
          ) : (
            <TabCard description="Welche Schnittstellen des Jellyfin-Servers das Dashboard zeigt und wofür sie da sind. Der Agent misst nur diese, und nur solange Manelly sie anzeigt oder aufzeichnet.">
              {agentSettings.error ? (
                <p className="text-critical">{agentSettings.error.message}</p>
              ) : !agentSettings.data ? (
                <div aria-busy className="h-24 animate-pulse rounded-xl bg-card-2" />
              ) : agentSettings.data.url ? (
                <NetworkInterfacesForm />
              ) : (
                <p className="text-ink-2">
                  Die Schnittstellen misst der Agent auf dem Jellyfin-Server. Zuerst den Agent unter{' '}
                  <Link to="/server/agent" className="font-medium text-accent hover:underline">
                    Server → Agent
                  </Link>{' '}
                  verbinden.
                </p>
              )}
            </TabCard>
          )}
        </Tabs>
      </div>
    </div>
  );
}
