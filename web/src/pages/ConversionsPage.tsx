import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { ConversionJob, CopyThrottle } from '@manelly/shared';
import { Ban, Clock, Pause, Play, RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import { ConversionProgress, isActive, MODE_LABELS, StateBadge, STEP_LABELS } from '../components/ConversionStatus';
import { InterfaceTile } from '../components/NetworkInterfaces';
import { SchedulePanel } from '../components/SchedulePanel';
import { OriginalsPanel } from '../components/OriginalsPanel';
import { WorkFolderPanel } from '../components/WorkFolderPanel';
import { useAgent, useAgentNetwork, useCancelConversion, useConversions, usePauseConversion, useRemoveConversion, useStartConversionNow } from '../hooks/queries';
import { formatAgo, formatBitrate, formatBytes, formatEta, formatSpeed, joinParts } from '../lib/format';
import { roleLabel } from '../lib/networkRoles';

export function ConversionsPage() {
  useEffect(() => {
    document.title = 'Umwandlungen · Manelly';
  }, []);
  const agent = useAgent();
  const configured = agent.data?.configured === true;
  const jobs = useConversions(configured);

  return (
    <div className="mx-auto max-w-4xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Umwandlungen</h1>
        <p className="mt-1 text-sm text-ink-2">
          Dolby Vision Profil 7 in Profil 8.1 umwandeln – direkt auf dem Jellyfin-Server, mit dem Manelly-Agent.
        </p>
      </header>

      <div className="mt-6 space-y-4">
        {agent.isPending && <div aria-busy className="h-24 animate-pulse rounded-2xl bg-card-2" />}
        {agent.data && !configured && (
          <Panel>
            <p className="font-medium">Noch kein Agent eingerichtet</p>
            <p className="mt-1 text-sm text-ink-2">
              Installiere den Agent auf dem Jellyfin-Server mit <code>scripts\start-agent.cmd</code> und trage Adresse und Schlüssel unter{' '}
              <Link to="/server/agent" className="font-medium text-accent hover:underline">
                Server → Agent
              </Link>{' '}
              ein.
            </p>
          </Panel>
        )}
        {agent.data?.error && <Panel tone="critical">{agent.data.error}</Panel>}
        {agent.data?.status && !agent.data.status.ready && (
          <Panel tone="critical">
            Dem Agent auf {agent.data.status.hostname} fehlen Werkzeuge – Details unter{' '}
            <Link to="/server/agent" className="font-medium underline">
              Server → Agent
            </Link>
            .
          </Panel>
        )}

        {agent.data?.status &&
          (agent.data.status.schedule ? (
            <>
              <SchedulePanel schedule={agent.data.status.schedule} />
              {/* Missing on agents before 0.17.0. */}
              {agent.data.status.work && <WorkFolderPanel work={agent.data.status.work} />}
              {/* Missing on agents before 0.18.0. */}
              {agent.data.status.originals && <OriginalsPanel />}
            </>
          ) : (
            <Panel>
              Der Agent auf {agent.data.status.hostname} ist zu alt für Zeitplan und Fortsetzen nach einem Neustart (Version{' '}
              {agent.data.status.version}). Auf dem Jellyfin-Server <code>git pull</code> und <code>scripts\start-agent.cmd -Install</code>{' '}
              ausführen.
            </Panel>
          ))}

        {configured && (
          <Panel>
            <p className="text-sm text-ink-2">
              Gestartet wird eine Umwandlung in den{' '}
              <Link to="/media?dynamicRange=DV7" className="font-medium text-accent hover:underline">
                Medien mit dem Filter «Dolby Vision P7»
              </Link>
              : Titel öffnen und «In Profil 8.1 umwandeln» wählen.
            </p>
          </Panel>
        )}

        {jobs.error && <Panel tone="critical">{jobs.error.message}</Panel>}
        {jobs.data?.length === 0 && <p className="text-sm text-ink-2">Noch keine Umwandlungen.</p>}
        {jobs.data?.map((job) => <JobCard key={job.id} job={job} />)}
      </div>
    </div>
  );
}

function JobCard({ job }: { job: ConversionJob }) {
  const cancel = useCancelConversion();
  const remove = useRemoveConversion();
  const startNow = useStartConversionNow();
  const pause = usePauseConversion();
  const active = isActive(job);
  // Agents before 0.12.0 cannot pause; their jobs lack the field.
  const pausable = active && job.paused !== undefined;

  return (
    <article className="rounded-2xl border border-line bg-card p-4 shadow-sm shadow-black/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">{job.title}</h2>
          <p className="text-xs text-ink-3">
            {joinParts([
              MODE_LABELS[job.mode],
              `${job.scheduled ? 'eingeplant' : 'gestartet'} ${formatAgo(Date.parse(job.createdAt), Date.now())}`,
              job.sourceBytes ? formatBytes(job.sourceBytes) : null,
              job.state === 'done' && job.startedAt && job.finishedAt
                ? `Dauer ${formatEta((Date.parse(job.finishedAt) - Date.parse(job.startedAt)) / 1000)}`
                : null,
            ])}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StateBadge job={job} />
          {job.state === 'queued' && job.scheduled && (
            <button type="button" onClick={() => startNow.mutate(job.id)} disabled={startNow.isPending} className={smallButton} title="Ohne auf den Zeitplan zu warten">
              <Play className="size-3.5" aria-hidden /> Jetzt starten
            </button>
          )}
          {pausable &&
            (job.paused ? (
              <button type="button" onClick={() => pause.mutate({ id: job.id, pause: false })} disabled={pause.isPending} className={smallButton}>
                <Play className="size-3.5" aria-hidden /> Fortsetzen
              </button>
            ) : (
              job.state === 'running' && (
                <button type="button" onClick={() => pause.mutate({ id: job.id, pause: true })} disabled={pause.isPending} className={smallButton}>
                  <Pause className="size-3.5" aria-hidden /> Pausieren
                </button>
              )
            ))}
          {active ? (
            <button type="button" onClick={() => cancel.mutate(job.id)} disabled={cancel.isPending} className={smallButton}>
              <Ban className="size-3.5" aria-hidden /> Abbrechen
            </button>
          ) : (
            <button type="button" onClick={() => remove.mutate(job.id)} disabled={remove.isPending} className={smallButton} aria-label="Aus der Liste entfernen" title="Aus der Liste entfernen">
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {job.state === 'running' && (
        <div className="mt-3">
          <ConversionProgress job={job} />
          {job.copyThrottle && <p className="mt-1 text-xs text-ink-3">{throttleReason(job.copyThrottle)}</p>}
        </div>
      )}
      {job.state === 'running' && job.paused && (
        <p className="mt-2 flex gap-2 text-sm text-ink-2">
          <Pause className="mt-0.5 size-4 shrink-0" aria-hidden />
          Pausiert – {job.step ? `«${STEP_LABELS[job.step]}»` : 'die Umwandlung'} ist angehalten und macht beim Fortsetzen genau dort weiter. Andere Umwandlungen
          warten so lange.
        </p>
      )}
      {job.state === 'running' && <StorageLoad />}
      {job.state === 'queued' && (
        <p className="mt-3 flex gap-2 text-sm text-ink-2">
          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
          {job.waitReason ?? 'Wartet, bis die laufende Umwandlung fertig ist.'}
        </p>
      )}
      {isActive(job) && Boolean(job.interruptions) && (
        <p className="mt-1 flex gap-2 text-xs text-ink-3">
          <RotateCcw className="mt-px size-3.5 shrink-0" aria-hidden />
          {job.interruptions === 1 ? 'Einmal' : `${job.interruptions}-mal`} unterbrochen (Stream oder Neustart) – macht beim zuletzt fertigen Schritt weiter.
        </p>
      )}
      {startNow.isError && <p className="mt-2 text-sm text-critical">{startNow.error.message}</p>}
      {pause.isError && <p className="mt-2 text-sm text-critical">{pause.error.message}</p>}

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-ink-3">Quelle</dt>
        <dd className="font-mono break-all">{job.source}</dd>
        <dt className="text-ink-3">Ziel</dt>
        <dd className="font-mono break-all">{job.output}</dd>
        {job.work && (
          <>
            <dt className="text-ink-3">Umgewandelt in</dt>
            <dd className="font-mono break-all">{job.work}</dd>
          </>
        )}
        {job.backup && (
          <>
            <dt className="text-ink-3">Backup</dt>
            <dd className="font-mono break-all">{job.backup}</dd>
          </>
        )}
      </dl>

      {job.warning && <p className="mt-3 flex gap-2 text-sm text-warning"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />{job.warning}</p>}
      {job.error && <p className="mt-3 text-sm text-critical">{job.error}</p>}
      {job.log && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-ink-2">Ausgabe des Werkzeugs</summary>
          <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-card-2 p-3 whitespace-pre-wrap">{job.log}</pre>
        </details>
      )}
      {job.state === 'done' && job.backup && (
        <p className="mt-3 text-xs text-ink-3">
          {job.work && job.mode === 'replace'
            ? 'Das Original liegt im Arbeitsordner. Passt das Ergebnis, kannst du es unter «Originale im Arbeitsordner» löschen.'
            : 'Passt das Ergebnis, kannst du das Backup löschen – Manelly macht das nicht von sich aus.'}
        </p>
      )}
    </article>
  );
}

/** Why the copy runs slower than it could – only while it does. */
function throttleReason({ bytesPerSecond, streams, streamsBitsPerSecond }: CopyThrottle): string {
  const limit = `Kopiert mit höchstens ${formatSpeed(bytesPerSecond)}`;
  if (streams === null) return `${limit}, wie beim Arbeitsordner eingestellt.`;
  const who = streams === 1 ? '1 Stream braucht' : `${streams} Streams brauchen`;
  return `${limit}: ${who} gerade etwa ${formatBitrate(streamsBitsPerSecond ?? 0)}, dazu 20 Mbit/s Reserve.`;
}

/**
 * How busy the way to the storage is – a conversion mostly copies, so that is what limits it rather than CPU or GPU.
 * The agent measures only while it is open.
 */
function StorageLoad() {
  const [open, setOpen] = useState(false);
  return (
    <details className="mt-3 text-xs" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-ink-2">Auslastung der Storage-Schnittstelle</summary>
      {open && (
        <div className="mt-3 rounded-lg bg-card-2/50 p-3 text-sm ring-1 ring-line">
          <StorageLoadDetails />
        </div>
      )}
    </details>
  );
}

function StorageLoadDetails() {
  const network = useAgentNetwork(true);
  if (network.error) return <p className="text-critical">{network.error.message}</p>;
  if (!network.data) return <div aria-busy className="h-24 animate-pulse rounded-lg bg-card-2" />;
  const storage = network.data.interfaces.filter((nic) => nic.roles?.includes('storage'));
  if (storage.length === 0) {
    return (
      <p className="text-ink-2">
        Gib in den{' '}
        <Link to="/settings#network" className="font-medium text-accent hover:underline">
          Einstellungen
        </Link>{' '}
        der Netzwerkschnittstelle zum Speicher (z. B. NAS) die Rolle «Storage», um hier zu sehen, wie ausgelastet sie ist.
      </p>
    );
  }
  return (
    <>
      {network.data.error && <p className="mb-3 text-critical">{network.data.error}</p>}
      <ul className="grid gap-3 md:grid-cols-2">
        {storage.map((nic) => {
          const shared = (nic.roles ?? []).filter((role) => role !== 'storage');
          return (
            <li key={nic.id}>
              <InterfaceTile
                nic={nic}
                intervalMs={network.data.intervalMs}
                storage
                note={shared.length > 0 && `Dient auch für ${shared.map(roleLabel).join(' und ')} – Lesen und Schreiben enthalten auch diesen Verkehr.`}
              />
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Panel({ tone, children }: { tone?: 'critical'; children: ReactNode }) {
  return (
    <div className={clsx('rounded-2xl border p-4 text-sm', tone === 'critical' ? 'border-critical/30 bg-critical/8' : 'border-line bg-card')}>
      {children}
    </div>
  );
}

const smallButton =
  'inline-flex items-center gap-1.5 rounded-lg bg-card px-2.5 py-1 text-xs font-medium text-ink ring-1 ring-line transition hover:bg-card-2 disabled:opacity-60';
