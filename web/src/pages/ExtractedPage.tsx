import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { ExtractedList } from '../components/ExtractedList';
import { Message } from '../components/ConnectionForm';
import { useAgent, useAgentSettings } from '../hooks/queries';

/**
 * «Server → Extracted»: the extraction folder on the Jellyfin server – what JDownloader extracted and what was ripped
 * from discs –, from where it goes into the libraries.
 */
export function ExtractedPage() {
  useEffect(() => {
    document.title = 'Extracted · Server · Manelly';
  }, []);
  const navigate = useNavigate();
  const agentSettings = useAgentSettings();
  const agent = useAgent({ enabled: Boolean(agentSettings.data?.url) });
  const status = agent.data?.status;
  const jd = status?.jdownloader;

  let content;
  if (agentSettings.data && !agentSettings.data.url) {
    content = (
      <div className="rounded-2xl border border-line bg-card p-4 text-sm shadow-sm shadow-black/5 sm:p-5">
        Den Entpack-Ordner liest der Agent auf dem Jellyfin-Server. Zuerst den Agent unter{' '}
        <Link to="/server/agent" className="font-medium text-accent hover:underline">
          Server → Agent
        </Link>{' '}
        verbinden.
      </div>
    );
  } else if (agent.data?.error) {
    content = <Message tone="critical">{agent.data.error}</Message>;
  } else if (!status) {
    content = <div aria-busy className="h-48 animate-pulse rounded-2xl bg-card-2" />;
  } else if (!jd?.extracted) {
    content = (
      <Message tone="critical">
        Der Agent auf {status.hostname} ist zu alt für den Entpack-Ordner (Version {status.version}) – unter Einstellungen → Updates «Alles
        aktualisieren».
      </Message>
    );
  } else {
    content = (
      <ExtractedList
        // The folder is set in the JDownloader settings, as in JDownloader's own extractor.
        onOpenSettings={() => navigate('/server/jdownloader?settings')}
        actions={Boolean(jd.moves)}
        newFolders={Boolean(jd.newFolders)}
        deletable={Boolean(jd.extractedDelete)}
        convertible={Boolean(jd.extractedConvert)}
        renamable={Boolean(jd.extractedRename)}
        audio={Boolean(status.audio)}
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <p className="text-sm font-medium text-accent">Server</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Extracted</h1>
        <p className="mt-1 text-sm text-ink-2">
          Was im Entpack-Ordner des Jellyfin-Servers liegt – von{' '}
          <Link to="/server/jdownloader" className="font-medium text-accent hover:underline">
            JDownloader
          </Link>{' '}
          entpackt oder von{' '}
          <Link to="/server/discs" className="font-medium text-accent hover:underline">
            Discs
          </Link>{' '}
          gerippt. Von hier kommt es mit «Move to Library» in die Mediathek.
        </p>
      </header>
      {content}
    </div>
  );
}
