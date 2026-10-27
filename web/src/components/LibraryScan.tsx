import type { LibraryScanStatus } from '@manelly/shared';
import { CircleCheck, CircleMinus, CircleX, FolderSearch, LoaderCircle, X, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { useLibraryScan, useLibraryScanAction } from '../hooks/queries';
import { useNow } from '../hooks/useNow';
import { formatAgo } from '../lib/format';
import { LIBRARY_TYPE_LABELS } from '../lib/media';
import { formatSpan } from '../lib/timeline';
import { Message } from './ConnectionForm';

type Result = NonNullable<LibraryScanStatus['lastRun']>['result'];

const RESULTS: Record<Result, { label: string; icon: LucideIcon; tone: string }> = {
  completed: { label: 'fertig', icon: CircleCheck, tone: 'text-good' },
  failed: { label: 'fehlgeschlagen', icon: CircleX, tone: 'text-critical' },
  cancelled: { label: 'abgebrochen', icon: CircleMinus, tone: 'text-ink-3' },
  // Jellyfin stopped it itself, e.g. while shutting down.
  aborted: { label: 'unterbrochen', icon: CircleMinus, tone: 'text-warning' },
};

const HINT = 'Jellyfin sucht in den Ordnern aller Mediatheken nach neuen, geänderten und gelöschten Dateien. Ist der Scan fertig, liest Manelly die Medien neu ein.';

const button =
  'inline-flex items-center gap-2 rounded-lg bg-card px-4 py-2 text-sm font-medium text-ink ring-1 ring-line transition hover:bg-card-2 disabled:cursor-wait disabled:opacity-60';

/** Within a day relative, older with the date. */
function when(iso: string, now: number): string {
  const at = Date.parse(iso);
  return now - at < 86_400_000 ? formatAgo(at, now) : `am ${new Date(at).toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' })}`;
}

function Progress({ status }: { status: LibraryScanStatus }) {
  return (
    <div role="status">
      <div className="mb-1.5 flex justify-between gap-3 text-sm">
        <span className="flex items-center gap-2">
          <LoaderCircle className="size-4 animate-spin text-accent" aria-hidden />
          {status.state === 'cancelling' ? 'Scan wird abgebrochen …' : 'Jellyfin scannt die Mediatheken …'}
        </span>
        {status.progress !== null && <span className="tabular-nums">{Math.round(status.progress)} %</span>}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-accent/15">
        {/* Until Jellyfin reports a percentage, the bar only says that it works. */}
        <div
          className={clsx('bg-brand h-full rounded-full transition-[width]', status.progress === null && 'animate-pulse opacity-40')}
          style={{ width: `${status.progress ?? 100}%` }}
        />
      </div>
    </div>
  );
}

function LastRun({ run, now }: { run: LibraryScanStatus['lastRun']; now: number }) {
  if (!run?.endedAt) return <p className="text-sm text-ink-2">Jellyfin hat die Mediatheken noch nie gescannt.</p>;
  const { label, icon: Icon, tone } = RESULTS[run.result];
  const took = run.startedAt ? Date.parse(run.endedAt) - Date.parse(run.startedAt) : null;
  return (
    <div className="text-sm">
      <p className="flex flex-wrap items-center gap-x-1.5">
        <Icon className={clsx('size-4 shrink-0', tone)} aria-hidden />
        <span>
          Letzter Scan {label} {when(run.endedAt, now)}
          {took !== null && took >= 0 && <span className="text-ink-2"> · Dauer {formatSpan(took)}</span>}
        </span>
      </p>
      {run.error && <p className="mt-1 text-xs break-words text-ink-2">{run.error}</p>}
    </div>
  );
}

/** Jellyfin's scan of all libraries – start, follow, stop – and the folders it looks in. */
export function LibraryScanPanel() {
  // Also notices a scan started in Jellyfin itself.
  const scan = useLibraryScan(true, 30_000);
  const action = useLibraryScanAction();
  const now = useNow(30_000);
  const status = scan.data;
  if (!status) {
    return scan.error ? <Message tone="critical">{scan.error.message}</Message> : <div aria-busy className="h-24 animate-pulse rounded-xl bg-card-2" />;
  }
  const busy = status.state !== 'idle';

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">{HINT}</p>
      {busy ? <Progress status={status} /> : <LastRun run={status.lastRun} now={now} />}
      <div className="flex flex-wrap gap-2">
        {busy ? (
          <button type="button" className={button} disabled={action.isPending || status.state === 'cancelling'} onClick={() => action.mutate('cancel')}>
            <X className="size-4" aria-hidden /> Abbrechen
          </button>
        ) : (
          <button type="button" className={button} disabled={action.isPending} onClick={() => action.mutate('start')}>
            <FolderSearch className="size-4" aria-hidden /> Mediatheken scannen
          </button>
        )}
      </div>
      {action.isError && <Message tone="critical">{action.error.message}</Message>}
      {status.libraries.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {status.libraries.map((library) => (
            <li key={library.name} className="px-3 py-2 text-sm">
              <p>
                <span className="font-medium">{library.name}</span>
                <span className="text-xs text-ink-3"> · {LIBRARY_TYPE_LABELS[library.type ?? 'mixed'] ?? library.type}</span>
              </p>
              {library.locations.map((location) => (
                <p key={location} className="font-mono text-xs break-all text-ink-2">
                  {location}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The scan in a line, next to the index of the media page. */
export function LibraryScanButton() {
  const scan = useLibraryScan(true);
  const action = useLibraryScanAction();
  const status = scan.data;
  if (status && status.state !== 'idle') {
    return (
      <span role="status" className="inline-flex shrink-0 items-center gap-1.5 px-1 font-medium whitespace-nowrap text-ink">
        <LoaderCircle className="size-3.5 animate-spin text-accent" aria-hidden />
        {status.state === 'cancelling' ? 'Scan wird abgebrochen …' : `Jellyfin scannt${status.progress !== null ? ` ${Math.round(status.progress)} %` : ' …'}`}
      </span>
    );
  }
  const error = action.error?.message ?? scan.error?.message;
  return (
    <button
      type="button"
      onClick={() => action.mutate('start')}
      disabled={!status || action.isPending}
      title={error ?? HINT}
      className={clsx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-card px-2.5 py-1.5 font-medium whitespace-nowrap shadow-sm ring-1 ring-line hover:bg-card-2 disabled:opacity-60',
        action.isError ? 'text-critical' : 'text-ink',
      )}
    >
      <FolderSearch className="size-3.5" aria-hidden />
      {action.isError ? 'Scan nicht gestartet' : 'Mediatheken scannen'}
    </button>
  );
}
