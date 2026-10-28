import { useEffect } from 'react';
import { Link } from 'react-router';
import { AgentNotices, ConversionsHeader, Panel } from '../components/ConversionPanels';
import { OriginalsList } from '../components/OriginalsList';
import { useAgent } from '../hooks/queries';
import { OLD_DAYS, STALE_DAYS } from '../lib/originals';

/** «Umwandlungen → Backups»: the originals kept in the work folder, until they are deleted here. */
export function ConversionBackupsPage() {
  useEffect(() => {
    document.title = 'Backups · Umwandlungen · Manelly';
  }, []);
  const agent = useAgent();
  const status = agent.data?.status;

  return (
    <div className="mx-auto max-w-4xl">
      <ConversionsHeader title="Backups">
        Was «Original ersetzen» im Arbeitsordner ersetzt hat, bleibt dort, bis du es hier löschst – auf dem Speicher liegt nur noch die
        umgewandelte Datei. Länger als {OLD_DAYS} Tage aufbewahrt: gelb, länger als {STALE_DAYS} Tage: rot.
      </ConversionsHeader>

      <div className="mt-6 space-y-4">
        <AgentNotices agent={agent} />
        {status &&
          // Missing on agents before 0.18.0.
          (status.originals ? (
            <OriginalsList />
          ) : (
            <Panel>
              Der Agent auf {status.hostname} behält noch keine Originale im Arbeitsordner (Version {status.version}). Unter{' '}
              <Link to="/server/agent" className="font-medium text-accent hover:underline">
                Server → Agent
              </Link>{' '}
              «Aktualisieren & neu starten».
            </Panel>
          ))}
      </div>
    </div>
  );
}
