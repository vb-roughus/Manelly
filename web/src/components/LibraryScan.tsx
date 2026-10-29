import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { LibraryScanEntry, LibraryScanStatus } from '@manelly/shared';
import { ChevronDown, CircleCheck, CircleMinus, CircleX, FolderSearch, LoaderCircle, Tv, X, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { useLibraryScan, useLibraryScanAction, useLibrarySeries, useScanItem, useSeriesSeasons } from '../hooks/queries';
import { useNow } from '../hooks/useNow';
import { formatAgo } from '../lib/format';
import { LIBRARY_TYPE_LABELS } from '../lib/media';
import { formatSpan } from '../lib/timeline';
import { Message } from './ConnectionForm';
import { Modal } from './Modal';

type Result = NonNullable<LibraryScanStatus['lastRun']>['result'];

const RESULTS: Record<Result, { label: string; icon: LucideIcon; tone: string }> = {
  completed: { label: 'fertig', icon: CircleCheck, tone: 'text-good' },
  failed: { label: 'fehlgeschlagen', icon: CircleX, tone: 'text-critical' },
  cancelled: { label: 'abgebrochen', icon: CircleMinus, tone: 'text-ink-3' },
  // Jellyfin stopped it itself, e.g. while shutting down.
  aborted: { label: 'unterbrochen', icon: CircleMinus, tone: 'text-warning' },
};

const HINT =
  'Jellyfin sucht in den Ordnern der Mediatheken nach neuen, geänderten und gelöschten Dateien – in allen auf einmal oder nur in einer. Ist der Scan fertig, liest Manelly die Medien neu ein.';
const SINGLE_HINT = 'Viel schneller als alle, wenn andere gross sind – etwa Serien mit vielen Ordnern. Jellyfin kann diesen Scan nicht abbrechen.';
export const SERIES_HINT =
  'Jellyfin sucht nur im Ordner dieser Serie nach neuen, geänderten und gelöschten Dateien – meist in Sekunden statt Minuten. Eine ganz neue Serie findet erst der Scan der Mediathek.';

/** A library whose series can be scanned one by one. */
const hasSeries = (library: LibraryScanEntry) => library.type === 'tvshows' && library.id !== null;

/** The kind of library, unless its name says it already («Filme · Filme»). */
function typeLabel(library: LibraryScanEntry): string | null {
  const label = LIBRARY_TYPE_LABELS[library.type ?? 'mixed'] ?? library.type;
  return label && label.toLowerCase() !== library.name.toLowerCase() ? label : null;
}
const percent = (progress: number | null) => (progress !== null ? ` ${Math.round(progress)} %` : ' …');

/** What is being scanned, in a few words; null when nothing is. */
function scanLabel(status: LibraryScanStatus): string | null {
  if (status.state === 'cancelling') return 'Scan wird abgebrochen …';
  if (status.state === 'running') return `Jellyfin scannt${percent(status.progress)}`;
  const scanning = status.libraries.filter((library) => library.scanning);
  if (scanning.length === 1) return `«${scanning[0]!.name}» wird gescannt${percent(scanning[0]!.progress)}`;
  if (scanning.length > 1) return `${scanning.length} Mediatheken werden gescannt …`;
  return null;
}

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
          {status.state === 'cancelling' ? 'Scan wird abgebrochen …' : 'Jellyfin scannt alle Mediatheken …'}
        </span>
        {status.progress !== null && <span className="tabular-nums">{Math.round(status.progress)} %</span>}
      </div>
      <Bar progress={status.progress} className="h-1.5" />
    </div>
  );
}

function LastRun({ run, now }: { run: LibraryScanStatus['lastRun']; now: number }) {
  if (!run?.endedAt) return <p className="text-sm text-ink-2">Jellyfin hat noch nie alle Mediatheken auf einmal gescannt.</p>;
  const { label, icon: Icon, tone } = RESULTS[run.result];
  const took = run.startedAt ? Date.parse(run.endedAt) - Date.parse(run.startedAt) : null;
  return (
    <div className="text-sm">
      <p className="flex flex-wrap items-center gap-x-1.5">
        <Icon className={clsx('size-4 shrink-0', tone)} aria-hidden />
        <span>
          Letzter Scan aller Mediatheken {label} {when(run.endedAt, now)}
          {took !== null && took >= 0 && <span className="text-ink-2"> · Dauer {formatSpan(took)}</span>}
        </span>
      </p>
      {run.error && <p className="mt-1 text-xs break-words text-ink-2">{run.error}</p>}
    </div>
  );
}

/** Jellyfin's scan of all libraries or of single ones – start, follow, stop – and the folders it looks in. */
export function LibraryScanPanel() {
  // Also notices a scan started in Jellyfin itself.
  const scan = useLibraryScan(true, 30_000);
  const action = useLibraryScanAction();
  const now = useNow(30_000);
  const [seriesOf, setSeriesOf] = useState<LibraryScanEntry | null>(null);
  const status = scan.data;
  if (!status) {
    return scan.error ? <Message tone="critical">{scan.error.message}</Message> : <div aria-busy className="h-24 animate-pulse rounded-xl bg-card-2" />;
  }
  const busy = status.state !== 'idle';
  const starting = (library: LibraryScanEntry) => action.isPending && action.variables !== 'cancel' && action.variables.libraryId === library.id;

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
          <button type="button" className={button} disabled={action.isPending} onClick={() => action.mutate({})}>
            <FolderSearch className="size-4" aria-hidden /> Alle Mediatheken scannen
          </button>
        )}
      </div>
      {action.isError && <Message tone="critical">{action.error.message}</Message>}
      {status.libraries.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {status.libraries.map((library) => (
            <li key={library.id ?? library.name} className="px-3 py-2 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p>
                    <span className="font-medium">{library.name}</span>
                    {typeLabel(library) && <span className="text-xs text-ink-3"> · {typeLabel(library)}</span>}
                  </p>
                  {library.locations.map((location) => (
                    <p key={location} className="font-mono text-xs break-all text-ink-2">
                      {location}
                    </p>
                  ))}
                </div>
                {library.scanning ? (
                  <span role="status" className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium whitespace-nowrap">
                    <LoaderCircle className="size-3.5 animate-spin text-accent" aria-hidden />
                    Scannt{percent(library.progress)}
                  </span>
                ) : (
                  library.id && (
                    <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                      {hasSeries(library) && (
                        <button
                          type="button"
                          onClick={() => setSeriesOf(library)}
                          disabled={busy}
                          aria-label={`Einzelne Serie aus «${library.name}» scannen`}
                          title={busy ? 'Wird beim Scan aller Mediatheken mitgescannt' : SERIES_HINT}
                          className={smallButton}
                        >
                          <Tv className="size-3.5" aria-hidden /> Serie …
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => action.mutate({ libraryId: library.id! })}
                        // The scan of all libraries takes this one in as well.
                        disabled={busy || starting(library)}
                        aria-label={`«${library.name}» scannen`}
                        title={busy ? 'Wird beim Scan aller Mediatheken mitgescannt' : `Nur «${library.name}» scannen. ${SINGLE_HINT}`}
                        className={smallButton}
                      >
                        <FolderSearch className="size-3.5" aria-hidden /> Scannen
                      </button>
                    </div>
                  )
                )}
              </div>
              {library.scanning && <Bar progress={library.progress} className="mt-2 h-1" />}
            </li>
          ))}
        </ul>
      )}
      <SeriesScanDialog library={seriesOf} onClose={() => setSeriesOf(null)} />
    </div>
  );
}

/** The scan in a line, next to the index of the media page: all libraries or one, chosen from a menu. */
export function LibraryScanButton() {
  const scan = useLibraryScan(true);
  const action = useLibraryScanAction();
  const [open, setOpen] = useState(false);
  const [seriesOf, setSeriesOf] = useState<LibraryScanEntry | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const status = scan.data;
  const seriesLibraries = status?.libraries.filter(hasSeries) ?? [];

  // A click elsewhere or Escape closes the menu.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = status ? scanLabel(status) : null;
  const all = status?.state !== undefined && status.state !== 'idle';
  const error = action.error?.message ?? scan.error?.message;
  const start = (request: { libraryId?: string }) => {
    setOpen(false);
    action.mutate(request);
  };

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={!status}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="library-scan-menu"
        title={error ?? HINT}
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-lg bg-card px-2.5 py-1.5 font-medium whitespace-nowrap shadow-sm ring-1 ring-line hover:bg-card-2 disabled:opacity-60',
          action.isError ? 'text-critical' : 'text-ink',
        )}
      >
        {label ? <LoaderCircle className="size-3.5 animate-spin text-accent" aria-hidden /> : <FolderSearch className="size-3.5" aria-hidden />}
        {/* Announced as it changes; a status role would drop it from the button's name. */}
        <span aria-live="polite">{label ?? (action.isError ? 'Scan nicht gestartet' : 'Mediatheken scannen')}</span>
        <ChevronDown className="size-3.5 text-ink-3" aria-hidden />
      </button>
      {open && status && (
        <ul
          id="library-scan-menu"
          role="menu"
          aria-label="Mediatheken scannen"
          className="absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-xl border border-line bg-card py-1 text-sm shadow-lg shadow-black/10"
        >
          <li role="none">
            <button type="button" role="menuitem" className={menuItem} disabled={all || action.isPending} onClick={() => start({})} title={HINT}>
              <span className="font-medium">Alle Mediatheken</span>
              {all && <MenuState progress={status.progress} />}
            </button>
          </li>
          {status.libraries.length > 0 && <li role="separator" className="my-1 border-t border-line" />}
          {status.libraries.map((library) => (
            <li key={library.id ?? library.name} role="none">
              <button
                type="button"
                role="menuitem"
                className={menuItem}
                disabled={!library.id || library.scanning || all || action.isPending}
                onClick={() => start({ libraryId: library.id! })}
                title={SINGLE_HINT}
              >
                <span className="min-w-0 truncate">
                  {library.name}
                  {typeLabel(library) && <span className="text-xs text-ink-3"> · {typeLabel(library)}</span>}
                </span>
                {library.scanning && <MenuState progress={library.progress} />}
              </button>
            </li>
          ))}
          {seriesLibraries.length > 0 && <li role="separator" className="my-1 border-t border-line" />}
          {seriesLibraries.map((library) => (
            <li key={`series-${library.id}`} role="none">
              <button
                type="button"
                role="menuitem"
                className={menuItem}
                disabled={all}
                onClick={() => {
                  setOpen(false);
                  setSeriesOf(library);
                }}
                title={SERIES_HINT}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Tv className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                  <span className="truncate">Einzelne Serie{seriesLibraries.length > 1 ? ` aus ${library.name}` : ''} …</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <SeriesScanDialog library={seriesOf} onClose={() => setSeriesOf(null)} />
    </div>
  );
}

/** Scanning one series of `library`, or one of its season folders, alone. */
function SeriesScanDialog({ library, onClose }: { library: LibraryScanEntry | null; onClose: () => void }) {
  return (
    <Modal
      open={library !== null}
      onClose={onClose}
      icon={Tv}
      title="Einzelne Serie scannen"
      description={library && `Aus «${library.name}»: Jellyfin sucht nur im Ordner der Serie nach neuen, geänderten und gelöschten Dateien.`}
    >
      {library?.id && <SeriesScanForm libraryId={library.id} onClose={onClose} />}
    </Modal>
  );
}

function SeriesScanForm({ libraryId, onClose }: { libraryId: string; onClose: () => void }) {
  const seriesList = useLibrarySeries(libraryId);
  const [seriesId, setSeriesId] = useState('');
  const show = seriesList.data?.find((candidate) => candidate.id === seriesId) ?? null;
  const seasonList = useSeriesSeasons(show?.id ?? null);
  const seasons = seasonList.data ?? [];
  const [seasonChoice, setSeasonChoice] = useState<{ series: string; id: string } | null>(null);
  const season = show && seasonChoice?.series === show.id ? (seasons.find((candidate) => candidate.id === seasonChoice.id) ?? null) : null;
  const scan = useScanItem();
  const folder = season?.path ?? show?.path;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (show) scan.mutate((season ?? show).id);
  }

  return (
    <form onSubmit={submit} className="space-y-4 text-sm">
      {seriesList.error ? (
        <Message tone="critical">{seriesList.error.message}</Message>
      ) : (
        <div>
          <label htmlFor="scan-series" className="mb-1.5 block font-medium">
            Serie
          </label>
          <select
            id="scan-series"
            value={seriesId}
            onChange={(event) => {
              setSeriesId(event.target.value);
              scan.reset();
            }}
            disabled={!seriesList.data}
            className={fieldClass}
          >
            <option value="" disabled>
              {!seriesList.data ? 'Serien werden geladen …' : seriesList.data.length ? 'Serie wählen …' : 'Jellyfin kennt hier keine Serie'}
            </option>
            {seriesList.data?.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
                {candidate.year && !candidate.name.includes(String(candidate.year)) ? ` (${candidate.year})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {show && seasons.length > 0 && (
        <div>
          <label htmlFor="scan-season" className="mb-1.5 block font-medium">
            Staffel
          </label>
          <select
            id="scan-season"
            value={season?.id ?? ''}
            onChange={(event) => {
              setSeasonChoice({ series: show.id, id: event.target.value });
              scan.reset();
            }}
            className={fieldClass}
          >
            <option value="">Ganze Serie</option>
            {seasons.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {folder && (
        <p className="rounded-lg bg-card-2/50 px-3 py-2 text-xs ring-1 ring-line">
          <span className="text-ink-2">Ordner: </span>
          <span className="font-mono break-all">{folder}</span>
        </p>
      )}
      <p className="text-xs text-ink-3">Eine ganz neue Serie, deren Ordner Jellyfin noch nicht kennt, findet erst der Scan der ganzen Mediathek.</p>
      {scan.isSuccess && (
        <Message tone="good">
          Jellyfin prüft jetzt «{scan.data.name}» – meist in wenigen Sekunden. Manelly liest die Medien danach neu ein, nach etwa einer halben Minute.
        </Message>
      )}
      {scan.isError && <Message tone="critical">{scan.error.message}</Message>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={dialogButton}>
          {scan.isSuccess ? 'Schliessen' : 'Abbrechen'}
        </button>
        <button type="submit" disabled={!show || scan.isPending || scan.isSuccess} className={primaryButton}>
          {scan.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <FolderSearch className="size-4" aria-hidden />}
          Scannen
        </button>
      </div>
    </form>
  );
}

function MenuState({ progress }: { progress: number | null }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-ink-2">
      <LoaderCircle className="size-3 animate-spin text-accent" aria-hidden />
      {progress !== null ? `${Math.round(progress)} %` : 'läuft'}
    </span>
  );
}

function Bar({ progress, className }: { progress: number | null; className?: string }) {
  return (
    <div className={clsx('overflow-hidden rounded-full bg-accent/15', className)}>
      {/* Until Jellyfin reports a percentage, the bar only says that it works. */}
      <div
        className={clsx('bg-brand h-full rounded-full transition-[width]', progress === null && 'animate-pulse opacity-40')}
        style={{ width: `${progress ?? 100}%` }}
      />
    </div>
  );
}

const fieldClass =
  'block w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-3 focus:ring-accent/20 disabled:opacity-60';
const dialogButton =
  'inline-flex items-center gap-1.5 rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-ink ring-1 ring-line transition hover:bg-card-2';
const primaryButton =
  'bg-brand inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50';

const smallButton =
  'inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-card px-2.5 py-1 text-xs font-medium text-ink ring-1 ring-line transition hover:bg-card-2 disabled:opacity-50';

const menuItem =
  'flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-card-2 focus-visible:bg-card-2 focus-visible:outline-none disabled:cursor-default disabled:text-ink-3 disabled:hover:bg-transparent';
