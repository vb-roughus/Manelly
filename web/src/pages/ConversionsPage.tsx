import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { ConversionJob } from '@manelly/shared';
import { Ban, Trash2, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import { ConversionProgress, isActive, MODE_LABELS, StateBadge } from '../components/ConversionStatus';
import { useAgent, useCancelConversion, useConversions, useRemoveConversion } from '../hooks/queries';
import { formatAgo } from '../lib/format';

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
              <Link to="/settings" className="font-medium text-accent hover:underline">
                Einstellungen
              </Link>{' '}
              ein.
            </p>
          </Panel>
        )}
        {agent.data?.error && <Panel tone="critical">{agent.data.error}</Panel>}
        {agent.data?.status && !agent.data.status.ready && (
          <Panel tone="critical">
            Dem Agent auf {agent.data.status.hostname} fehlen Werkzeuge – Details unter{' '}
            <Link to="/settings" className="font-medium underline">
              Einstellungen
            </Link>
            .
          </Panel>
        )}

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
  const active = isActive(job);

  return (
    <article className="rounded-2xl border border-line bg-card p-4 shadow-sm shadow-black/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">{job.title}</h2>
          <p className="text-xs text-ink-3">
            {MODE_LABELS[job.mode]} · gestartet {formatAgo(Date.parse(job.createdAt), Date.now())}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StateBadge job={job} />
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
        </div>
      )}

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-ink-3">Quelle</dt>
        <dd className="font-mono break-all">{job.source}</dd>
        <dt className="text-ink-3">Ziel</dt>
        <dd className="font-mono break-all">{job.output}</dd>
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
        <p className="mt-3 text-xs text-ink-3">Passt das Ergebnis, kannst du das Backup löschen – Manelly macht das nicht von sich aus.</p>
      )}
    </article>
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
