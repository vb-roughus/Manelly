import { useState } from 'react';
import type { ArchivedOriginal } from '@manelly/shared';
import { LoaderCircle, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { useOriginals, useRemoveOriginal } from '../hooks/queries';
import { useNow } from '../hooks/useNow';
import { formatBytes } from '../lib/format';
import { originalAge } from '../lib/originals';

const TONES = {
  fresh: { border: 'border-line', text: 'text-ink-2' },
  old: { border: 'border-warning/70', text: 'text-warning' },
  stale: { border: 'border-critical/70', text: 'text-critical' },
} as const;

/**
 * The originals that «Original ersetzen» in the work folder replaced: kept on the work disk instead of the storage,
 * until they are deleted here. Long-kept ones stand out.
 */
export function OriginalsList() {
  const originals = useOriginals(true);
  const now = useNow(60_000);
  const list = originals.data?.originals ?? [];
  const bytes = list.reduce((sum, original) => sum + (original.bytes ?? 0), 0);

  if (originals.error) return <p className="text-sm text-critical">{originals.error.message}</p>;
  if (!originals.data) return <div aria-busy className="h-24 animate-pulse rounded-2xl bg-card-2" />;
  return (
    <section aria-label="Backups im Arbeitsordner">
      <p className="text-xs text-ink-2">
        {list.length ? `${list.length} ${list.length === 1 ? 'Original' : 'Originale'} · ${formatBytes(bytes)}` : 'Noch keine Originale aufbewahrt.'}
        {originals.data.freeBytes !== null && ` · frei im Arbeitsordner: ${formatBytes(originals.data.freeBytes)}`}
      </p>
      {list.length > 0 && (
        <ul className="mt-2 space-y-2">
          {list.map((original) => (
            <OriginalRow key={original.id} original={original} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

function OriginalRow({ original, now }: { original: ArchivedOriginal; now: number }) {
  const remove = useRemoveOriginal();
  const [confirming, setConfirming] = useState(false);
  const { days, tone } = originalAge(original.archivedAt, now);
  const since = new Date(original.archivedAt).toLocaleDateString('de-CH', { dateStyle: 'medium' });

  return (
    <li className={clsx('rounded-xl border border-l-4 bg-card p-3 text-sm', TONES[tone].border)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="font-medium">{original.title}</p>
          <p className="text-xs">
            <span className={clsx('font-medium', TONES[tone].text)}>{days === 0 ? 'seit heute' : days === 1 ? 'seit 1 Tag' : `seit ${days} Tagen`}</span>
            <span className="text-ink-3">
              {' '}
              · aufbewahrt am {since}
              {original.bytes !== null && ` · ${formatBytes(original.bytes)}`}
            </span>
          </p>
        </div>
        {confirming ? (
          <span className="flex items-center gap-2">
            <span className="text-xs text-ink-2">Endgültig löschen?</span>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => remove.mutate(original.id)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-critical px-2.5 py-1 text-xs font-semibold text-white transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
            >
              {remove.isPending && <LoaderCircle className="size-3.5 animate-spin" aria-hidden />}
              Löschen
            </button>
            <button type="button" disabled={remove.isPending} onClick={() => setConfirming(false)} className={smallButton}>
              Abbrechen
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className={smallButton} aria-label={`${original.title} löschen`}>
            <Trash2 className="size-3.5" aria-hidden /> Löschen
          </button>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-ink-3">War</dt>
        <dd className="font-mono break-all text-ink-2">{original.source}</dd>
        <dt className="text-ink-3">Liegt</dt>
        <dd className="font-mono break-all text-ink-2">{original.path}</dd>
      </dl>
      {remove.isError && <p className="mt-2 text-xs text-critical">{remove.error.message}</p>}
    </li>
  );
}

const smallButton =
  'inline-flex items-center gap-1.5 rounded-lg bg-card px-2.5 py-1 text-xs font-medium text-ink ring-1 ring-line transition hover:bg-card-2 disabled:cursor-wait disabled:opacity-60';
