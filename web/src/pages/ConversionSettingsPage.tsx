import { useEffect } from 'react';
import { AgentNotices, ConversionsHeader, Panel } from '../components/ConversionPanels';
import { SchedulePanel } from '../components/SchedulePanel';
import { WorkFolderPanel } from '../components/WorkFolderPanel';
import { useAgent } from '../hooks/queries';

/** «Umwandlungen → Einstellungen»: when conversions run, where, and how fast they copy. */
export function ConversionSettingsPage() {
  useEffect(() => {
    document.title = 'Einstellungen · Umwandlungen · Manelly';
  }, []);
  const agent = useAgent();
  const status = agent.data?.status;

  return (
    <div className="mx-auto max-w-4xl">
      <ConversionsHeader title="Einstellungen">Wann Umwandlungen laufen, wo sie umwandeln und wie schnell sie kopieren.</ConversionsHeader>

      <div className="mt-6 space-y-4">
        <AgentNotices agent={agent} />
        {status &&
          (status.schedule ? (
            <>
              <SchedulePanel schedule={status.schedule} />
              {/* Missing on agents before 0.17.0. */}
              {status.work && <WorkFolderPanel work={status.work} />}
            </>
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
