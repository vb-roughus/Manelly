import type { ConversionJob, ConversionStep } from '@manelly/shared';
import { Ban, CalendarClock, CircleCheck, CircleX, Clock, LoaderCircle, Pause } from 'lucide-react';
import clsx from 'clsx';
import { formatBitrate, joinParts } from '../lib/format';

export const STEP_LABELS: Record<ConversionStep, string> = {
  fetch: 'Original in den Arbeitsordner kopieren',
  probe: 'Datei prüfen',
  extract: 'Videospur herauslösen',
  convert: 'Dolby Vision umwandeln',
  mux: 'Datei zusammensetzen',
  store: 'Ergebnis zurückkopieren',
  finalize: 'Datei an ihren Platz verschieben',
};

export const MODE_LABELS: Record<ConversionJob['mode'], string> = {
  alongside: 'Neben dem Original',
  replace: 'Original ersetzt',
  folder: 'Anderer Ordner',
};

export const isActive = (job: ConversionJob) => job.state === 'queued' || job.state === 'running';

const STATES = {
  queued: { icon: Clock, label: 'Wartet', className: 'text-ink-2' },
  running: { icon: LoaderCircle, label: 'Läuft', className: 'text-accent' },
  done: { icon: CircleCheck, label: 'Fertig', className: 'text-good' },
  failed: { icon: CircleX, label: 'Fehlgeschlagen', className: 'text-critical' },
  canceled: { icon: Ban, label: 'Abgebrochen', className: 'text-ink-2' },
} as const;
const SCHEDULED = { icon: CalendarClock, label: 'Geplant', className: 'text-ink-2' } as const;
const PAUSED = { icon: Pause, label: 'Pausiert', className: 'text-ink-2' } as const;

export function StateBadge({ job }: { job: ConversionJob }) {
  const meta = isActive(job) && job.paused ? PAUSED : job.state === 'queued' && job.scheduled ? SCHEDULED : STATES[job.state];
  const Icon = meta.icon;
  return (
    <span className={clsx('inline-flex shrink-0 items-center gap-1 text-xs font-medium', meta.className)}>
      <Icon className={clsx('size-3.5', job.state === 'running' && !job.paused && 'animate-spin')} aria-hidden />
      {meta.label}
    </span>
  );
}

/** Current step, how fast it moves the film, and overall progress of a running conversion. */
export function ConversionProgress({ job }: { job: ConversionJob }) {
  const percent = job.progress !== null ? Math.round(job.progress * 100) : null;
  const rate = !job.paused && job.bytesPerSecond != null ? formatBitrate(job.bytesPerSecond * 8) : null;
  return (
    <div>
      <div className="flex justify-between gap-2 text-xs text-ink-2">
        <span className="truncate">
          {job.step ? STEP_LABELS[job.step] : 'Startet …'}
          {job.paused && ' · pausiert'}
        </span>
        {(rate || percent !== null) && (
          <span className="shrink-0 tabular-nums" title={rate ? 'So schnell schreibt der laufende Schritt gerade' : undefined}>
            {joinParts([rate, percent !== null && `${percent} %`])}
          </span>
        )}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-card-2" role="progressbar" aria-label="Fortschritt" aria-valuenow={percent ?? undefined} aria-valuemin={0} aria-valuemax={100}>
        <div
          className={clsx(
            'h-full rounded-full transition-[width] duration-700',
            job.paused ? 'bg-ink-3/45' : 'bg-brand',
            percent === null && 'w-1/3',
            percent === null && !job.paused && 'animate-pulse',
          )}
          style={percent !== null ? { width: `${percent}%` } : undefined}
        />
      </div>
    </div>
  );
}
