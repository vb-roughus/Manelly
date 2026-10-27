import { Link } from 'react-router';
import type { ConversionJob } from '@manelly/shared';
import { ChevronDown, WandSparkles } from 'lucide-react';
import clsx from 'clsx';
import { useAgentSettings, useConversions } from '../hooks/queries';
import { useNow } from '../hooks/useNow';
import { usePersistentFlag } from '../hooks/usePersistentFlag';
import { formatAgo } from '../lib/format';
import { ConversionProgress, isActive, MODE_LABELS, StateBadge } from './ConversionStatus';

// Finished conversions stay on the dashboard for a while, so their outcome is not missed.
const RECENT_MS = 12 * 60 * 60_000;
const MAX_SHOWN = 4;

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Running and recently finished conversions of the agent; nothing at all without agent or conversions. */
export function DashboardConversions() {
  const settings = useAgentSettings();
  const configured = Boolean(settings.data?.url && settings.data.hasToken);
  const { data: jobs } = useConversions(configured);
  const now = useNow(30_000);

  const [open, setOpen] = usePersistentFlag('manelly.dashboard.conversions.open', true);

  const shown = (jobs ?? []).filter((job) => isActive(job) || (job.finishedAt && now - Date.parse(job.finishedAt) < RECENT_MS)).slice(0, MAX_SHOWN);
  if (shown.length === 0) return null;
  const active = shown.filter(isActive).length;
  const finished = shown.length - active;

  return (
    <section aria-labelledby="conversions-heading">
      <div className={clsx('flex flex-wrap items-baseline justify-between gap-2', open && 'mb-3')}>
        <h2 id="conversions-heading" className="text-lg font-semibold">
          <button
            type="button"
            aria-expanded={open}
            aria-controls="conversions-list"
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <WandSparkles className="size-4 text-accent" aria-hidden />
            Umwandlungen
            {(active > 0 || !open) && (
              <span className="text-sm font-normal text-ink-2">
                · {[active > 0 && `${active} aktiv`, !open && finished > 0 && `${finished} beendet`].filter(Boolean).join(', ')}
              </span>
            )}
            <ChevronDown className={clsx('size-4 text-ink-3 transition', !open && '-rotate-90')} aria-hidden />
          </button>
        </h2>
        <Link to="/conversions" className="text-sm font-medium text-accent hover:underline">
          Alle Umwandlungen
        </Link>
      </div>
      <ul id="conversions-list" hidden={!open} className="grid gap-3 md:grid-cols-2">
        {shown.map((job) => (
          <li key={job.id}>
            <ConversionTile job={job} now={now} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ConversionTile({ job, now }: { job: ConversionJob; now: number }) {
  return (
    <article className="h-full rounded-2xl border border-line bg-card p-4 shadow-sm shadow-black/5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 truncate font-semibold" title={job.title}>
          {job.title}
        </h3>
        <StateBadge job={job} />
      </div>
      <div className="mt-2 text-sm">
        {job.state === 'running' && <ConversionProgress job={job} />}
        {job.state === 'queued' && <p className="line-clamp-2 text-ink-2">{job.waitReason ?? 'Wartet, bis die laufende Umwandlung fertig ist.'}</p>}
        {job.state === 'done' && (
          <p className="truncate text-ink-2" title={job.output}>
            {MODE_LABELS[job.mode]} · {fileName(job.output)}
          </p>
        )}
        {job.state === 'failed' && <p className="line-clamp-2 text-critical">{job.error ?? 'Fehlgeschlagen.'}</p>}
        {job.warning && <p className="mt-1 line-clamp-2 text-xs text-warning">{job.warning}</p>}
      </div>
      {job.finishedAt && <p className="mt-2 text-xs text-ink-3">Beendet {formatAgo(Date.parse(job.finishedAt), now)}</p>}
    </article>
  );
}
