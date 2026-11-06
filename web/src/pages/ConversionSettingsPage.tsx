import { useEffect } from 'react';
import { CalendarClock, HardDrive } from 'lucide-react';
import { AgentNotices, ConversionsHeader, Panel } from '../components/ConversionPanels';
import { SchedulePanel } from '../components/SchedulePanel';
import { TabCard, Tabs, useTab, type TabEntry } from '../components/Tabs';
import { WorkFolderPanel } from '../components/WorkFolderPanel';
import { useAgent } from '../hooks/queries';

type Tab = 'schedule' | 'work';
const TABS: Array<TabEntry<Tab>> = [
  { id: 'schedule', label: 'Zeitplan', icon: CalendarClock },
  { id: 'work', label: 'Arbeitsordner', icon: HardDrive },
];

/** «Umwandlungen → Einstellungen»: when conversions run, where, and how fast they copy. */
export function ConversionSettingsPage() {
  useEffect(() => {
    document.title = 'Einstellungen · Umwandlungen · Manelly';
  }, []);
  const [tab, selectTab] = useTab(TABS);
  const agent = useAgent();
  const status = agent.data?.status;

  return (
    <div className="mx-auto max-w-4xl">
      <ConversionsHeader title="Einstellungen">Wann Umwandlungen laufen, wo sie umwandeln und wie schnell sie kopieren.</ConversionsHeader>

      <div className="mt-6 space-y-4">
        <AgentNotices agent={agent} />
        {status &&
          (status.schedule ? (
            <Tabs label="Einstellungen der Umwandlungen" tabs={TABS} tab={tab} onSelect={selectTab}>
              {tab === 'schedule' ? (
                <TabCard>
                  <SchedulePanel schedule={status.schedule} />
                </TabCard>
              ) : status.work ? (
                <TabCard>
                  <WorkFolderPanel work={status.work} />
                </TabCard>
              ) : (
                // Missing on agents before 0.17.0.
                <Panel>
                  Der Agent auf {status.hostname} ist zu alt für den Arbeitsordner (Version {status.version}). Unter Einstellungen → Updates «Alles
                  aktualisieren».
                </Panel>
              )}
            </Tabs>
          ) : (
            <Panel>
              Der Agent auf {status.hostname} ist zu alt für Zeitplan und Fortsetzen nach einem Neustart (Version {status.version}). Auf dem
              Jellyfin-Server <code>git pull</code> und <code>scripts\start-agent.cmd -Install</code> ausführen.
            </Panel>
          ))}
      </div>
    </div>
  );
}
