import { createContext, useContext, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { ConversionJob, DolbyVisionInfo, ExtractedEntry, ExtractedMove, LibrarySeries, MoveScan, SeriesSeason } from '@manelly/shared';
import {
  ChevronDown,
  CircleCheck,
  CircleX,
  File,
  FileText,
  Film,
  Folder,
  FolderInput,
  FolderOpen,
  FolderSearch,
  LoaderCircle,
  RefreshCw,
  ScanSearch,
  Settings,
  Trash2,
  TriangleAlert,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { useQueryClient } from '@tanstack/react-query';
import {
  useAgent,
  useConversions,
  useConvertExtracted,
  useDeleteExtracted,
  useDeleteSamples,
  useExtracted,
  useExtractedMoves,
  useExtractedSamples,
  useLibrarySeries,
  useMediaLibraries,
  useMoveExtracted,
  useSeriesSeasons,
} from '../hooks/queries';
import { useNow } from '../hooks/useNow';
import { initialChoices, loadChoices, rememberedChoices, saveChoices } from '../lib/convertChoices';
import { describeDolbyVision, dolbyVisionLabel, guessSeriesName, isExtractedFile, isFolderName, joinFolder, VIDEO } from '../lib/extracted';
import { formatAgo, formatBitrate, formatBytes, joinParts } from '../lib/format';
import { range } from '../lib/packageSelection';
import { describeSchedule, restricts } from '../lib/schedule';
import { seriesLabel } from '../lib/search';
import { Message } from './ConnectionForm';
import { isActive, STEP_LABELS } from './ConversionStatus';
import { Choice } from './media/ConvertDialog';
import { Modal } from './Modal';
import { SearchSelect } from './SearchSelect';
import { keepTextOnShift } from './Tick';

const TEXT = /\.(nfo|txt|srt|ass|ssa|sub|idx|sfv|md5)$/i;
/** Bigger than any sample usually is; such a file is not ticked for deleting by itself. */
const BIG_SAMPLE_BYTES = 1024 ** 3;
const LAST_TARGET_KEY = 'manelly.extracted.target';
/** Finished moves and conversions stay in sight this long. */
const RECENT_MS = 6 * 3_600_000;

const button =
  'inline-flex items-center gap-1.5 rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-ink ring-1 ring-line transition hover:bg-card-2 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButton =
  'bg-brand inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50';
const dangerButton =
  'inline-flex items-center gap-1.5 rounded-lg bg-critical px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50';

function iconFor(entry: ExtractedEntry, open: boolean): LucideIcon {
  if (entry.kind === 'directory') return open ? FolderOpen : Folder;
  return VIDEO.test(entry.name) ? Film : TEXT.test(entry.name) ? FileText : File;
}

/** Within a day relative, older with the date. */
function when(iso: string, now: number): string {
  const at = Date.parse(iso);
  return now - at < 86_400_000 ? formatAgo(at, now) : new Date(at).toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Small files in bytes, so a password note does not show as "0 KB". */
const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : formatBytes(bytes));

const lastName = (path: string) => path.split('/').pop() ?? path;

function details(entry: ExtractedEntry, now: number): string {
  const atLeast = entry.complete ? '' : 'mind. ';
  return joinParts([
    `${atLeast}${size(entry.bytes)}`,
    entry.files !== null && `${atLeast}${entry.files} ${entry.files === 1 ? 'Datei' : 'Dateien'}`,
    when(entry.updatedAt, now),
  ]);
}

/** A ticked entry: its size, and whether it is a folder. */
interface Ticked {
  bytes: number;
  folder: boolean;
}

/** The ticked entries, by path; a ticked folder covers everything in it. */
interface Selection {
  enabled: boolean;
  selected: Map<string, Ticked>;
  /** A click on an entry's box; with shift, every entry of `siblings` from the one clicked before gets the same. */
  toggle: (entry: ExtractedEntry, siblings: ExtractedEntry[], shift: boolean) => void;
}

const SelectionContext = createContext<Selection>({ enabled: false, selected: new Map(), toggle: () => {} });

const coveredBy = (selected: Map<string, Ticked>, path: string) => [...selected.keys()].some((other) => path.startsWith(`${other}/`));

/** Converting files with Dolby Vision profile 7 (agent from 0.31.0): opens the dialog, and knows the conversions. */
interface Conversions {
  enabled: boolean;
  open: (entry: ExtractedEntry) => void;
  /** The latest conversion of an entry, by its path in the folder. */
  jobFor: (path: string) => ConversionJob | undefined;
}

const ConversionsContext = createContext<Conversions>({ enabled: false, open: () => {}, jobFor: () => undefined });

/**
 * The conversions of files in the extraction folder, newest first; when one ends, the folder is read again, so the
 * file shows its new profile.
 */
function useFolderConversions(directory: string | null, enabled: boolean): ConversionJob[] {
  const queryClient = useQueryClient();
  const conversions = useConversions(enabled);
  const jobs = directory
    ? (conversions.data ?? []).filter((job) => isInFolder(job.source, directory)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];
  const active = jobs.filter(isActive).length;
  const previous = useRef(active);
  useEffect(() => {
    if (active < previous.current) void queryClient.invalidateQueries({ queryKey: ['jdownloader', 'extracted'] });
    previous.current = active;
  }, [active, queryClient]);
  return jobs;
}

/**
 * What lies in the folder JDownloader extracts into: newest first, folders open to show what is in them. Ticked
 * entries go into a library; samples can be looked for and deleted; files with Dolby Vision profile 7 can be converted
 * first. The agent reads only that folder.
 */
export function ExtractedList({
  onOpenSettings,
  actions,
  newFolders,
  deletable,
  convertible,
}: {
  onOpenSettings: () => void;
  actions: boolean;
  newFolders: boolean;
  /** Agent from 0.30.0: ticked entries can be deleted. */
  deletable: boolean;
  /** Agent from 0.31.0: files with Dolby Vision profile 7 can be converted here. */
  convertible: boolean;
}) {
  const root = useExtracted('', true, 60_000);
  const moves = useExtractedMoves(actions);
  const now = useNow(60_000);
  const [selected, setSelected] = useState<Map<string, Ticked>>(new Map());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'move' | 'samples' | 'delete' | null>(null);
  const [converting, setConverting] = useState<ExtractedEntry | null>(null);
  const jobs = useFolderConversions(root.data?.directory ?? null, convertible);

  function toggle(entry: ExtractedEntry, siblings: ExtractedEntry[], shift: boolean) {
    const tick = !selected.has(entry.path);
    const paths = shift ? range(siblings.map((each) => each.path), anchor, entry.path) : [entry.path];
    const next = new Map(selected);
    for (const each of siblings.filter((candidate) => paths.includes(candidate.path))) {
      if (!tick) next.delete(each.path);
      else if (!coveredBy(next, each.path)) {
        // Ticking a folder takes in what was ticked inside it.
        for (const path of next.keys()) if (path.startsWith(`${each.path}/`)) next.delete(path);
        next.set(each.path, { bytes: each.bytes, folder: each.kind === 'directory' });
      }
    }
    setSelected(next);
    setAnchor(entry.path);
  }

  if (root.error) return <Message tone="critical">{root.error.message}</Message>;
  if (!root.data) return <div aria-busy className="h-48 animate-pulse rounded-2xl bg-card-2" />;
  const { directory, entries, freeBytes, error } = root.data;

  if (!directory) {
    return (
      <div className="rounded-2xl border border-line bg-card p-4 text-sm shadow-sm shadow-black/5 sm:p-5">
        <p className="font-medium">Noch kein Entpack-Ordner festgelegt</p>
        <p className="mt-1 text-ink-2">In den Einstellungen den Ordner angeben, in den JDownloader die Archive entpackt – hier steht dann, was darin liegt.</p>
        <button type="button" onClick={onOpenSettings} className={clsx(button, 'mt-4')}>
          <Settings className="size-4" aria-hidden /> Einstellungen öffnen
        </button>
      </div>
    );
  }

  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const selectedBytes = [...selected.values()].reduce((sum, ticked) => sum + ticked.bytes, 0);
  const recentMoves = (moves.data ?? []).filter((move) => !move.finishedAt || now - Date.parse(move.finishedAt) < RECENT_MS).slice(0, 4);
  const conversions: Conversions = {
    enabled: convertible && !error,
    open: setConverting,
    jobFor: (path) => jobs.find((job) => isExtractedFile(job.source, directory, path)),
  };

  return (
    <SelectionContext.Provider value={{ enabled: actions && !error, selected, toggle }}>
      <div className="rounded-2xl border border-line bg-card p-4 text-sm shadow-sm shadow-black/5 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs break-all text-ink-2">{directory}</p>
            {!error && (
              <p className="mt-0.5 text-xs text-ink-3">
                {joinParts([
                  entries.length === 1 ? '1 Eintrag' : `${entries.length} Einträge`,
                  entries.length > 0 && size(total),
                  freeBytes !== null && `frei: ${formatBytes(freeBytes)}`,
                ])}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void root.refetch()}
            disabled={root.isFetching}
            aria-label="Neu einlesen"
            title="Neu einlesen"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-2 ring-1 ring-line transition hover:bg-card-2 hover:text-ink disabled:opacity-60"
          >
            <RefreshCw className={clsx('size-4', root.isFetching && 'animate-spin')} aria-hidden />
          </button>
        </div>

        {actions && !error && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setDialog('move')} disabled={selected.size === 0} className={primaryButton}>
              <FolderInput className="size-4" aria-hidden /> Move to Library
            </button>
            <button
              type="button"
              onClick={() => setDialog('delete')}
              disabled={selected.size === 0 || !deletable}
              title={deletable ? undefined : 'Löschen geht ab Agent 0.30.0 – unter Server → Agent «Aktualisieren & neu starten».'}
              className={button}
            >
              <Trash2 className="size-4" aria-hidden /> Löschen
            </button>
            <button type="button" onClick={() => setDialog('samples')} className={button}>
              <ScanSearch className="size-4" aria-hidden /> Check for Samples
            </button>
            {selected.size > 0 ? (
              <span className="text-xs text-ink-2">
                {selected.size} ausgewählt · {size(selectedBytes)} ·{' '}
                <button type="button" onClick={() => setSelected(new Map())} className="font-medium text-accent hover:underline">
                  Auswahl aufheben
                </button>
              </span>
            ) : (
              <span className="text-xs text-ink-3">Ordner oder Dateien ankreuzen, um sie zu verschieben oder zu löschen – mit Shift einen ganzen Bereich.</span>
            )}
          </div>
        )}
        {!actions && <p className="mt-3 text-xs text-ink-3">Verschieben in eine Mediathek und Samples löschen gehen ab Agent 0.27.0 – unter Server → Agent «Aktualisieren & neu starten».</p>}

        {recentMoves.length > 0 && (
          <ul className="mt-3 space-y-2" aria-label="Verschieben">
            {recentMoves.map((move) => (
              <MoveRow key={move.id} move={move} now={now} />
            ))}
          </ul>
        )}

        {error && <p className="mt-3 text-critical">{error}</p>}
        {!error && entries.length === 0 && <p className="mt-3 text-ink-2">Der Ordner ist leer.</p>}
        {entries.length > 0 && (
          <ConversionsContext.Provider value={conversions}>
            <ul className="mt-3 divide-y divide-line border-t border-line" onMouseDown={keepTextOnShift}>
              {entries.map((entry) => (
                <EntryRow key={entry.path} entry={entry} siblings={entries} now={now} />
              ))}
            </ul>
          </ConversionsContext.Provider>
        )}
      </div>

      <Modal
        open={dialog === 'move'}
        onClose={() => setDialog(null)}
        icon={FolderInput}
        title="In eine Mediathek verschieben"
        description="Die angekreuzten Einträge kommen in den gewählten Ordner einer Mediathek; Jellyfin erfährt gleich davon."
      >
        <MoveForm
          selected={selected}
          newFolders={newFolders}
          onDone={() => {
            setSelected(new Map());
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      </Modal>
      <Modal open={dialog === 'delete'} onClose={() => setDialog(null)} icon={Trash2} tone="critical" title="Im Entpack-Ordner löschen">
        <DeleteForm
          selected={selected}
          onDone={() => {
            setSelected(new Map());
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      </Modal>
      <Modal
        open={dialog === 'samples'}
        onClose={() => setDialog(null)}
        icon={ScanSearch}
        title="Samples suchen"
        description="Alle Dateien mit «sample» im Namen, im ganzen Entpack-Ordner. Prüfen, abwählen, was bleiben soll, dann löschen."
      >
        <SamplesForm onClose={() => setDialog(null)} />
      </Modal>
      <Modal open={converting !== null} onClose={() => setConverting(null)} icon={WandSparkles} title="In Dolby Vision Profil 8.1 umwandeln">
        {converting?.dolbyVision && <ConvertForm entry={converting} info={converting.dolbyVision} directory={directory} onClose={() => setConverting(null)} />}
      </Modal>
    </SelectionContext.Provider>
  );
}

function EntryRow({ entry, siblings, now }: { entry: ExtractedEntry; siblings: ExtractedEntry[]; now: number }) {
  const [open, setOpen] = useState(false);
  const selection = useContext(SelectionContext);
  const conversions = useContext(ConversionsContext);
  const Icon = iconFor(entry, open);
  const folder = entry.kind === 'directory';
  const covered = coveredBy(selection.selected, entry.path);
  const ticked = covered || selection.selected.has(entry.path);
  const job = folder || !conversions.enabled ? undefined : conversions.jobFor(entry.path);
  const convertible = conversions.enabled && entry.dolbyVision?.profile === 7 && !(job && isActive(job));
  const body = (
    <>
      <Icon className={clsx('mt-0.5 size-4 shrink-0', folder ? 'text-accent' : VIDEO.test(entry.name) ? 'text-ink' : 'text-ink-3')} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block font-medium break-words">
          {entry.name}
          {entry.dolbyVision && <DolbyVisionBadge info={entry.dolbyVision} />}
        </span>
        <span className="block text-xs text-ink-2">{details(entry, now)}</span>
        {job && <ConversionLine job={job} now={now} />}
      </span>
      {folder && <ChevronDown className={clsx('mt-0.5 size-4 shrink-0 text-ink-3 transition', !open && '-rotate-90')} aria-hidden />}
    </>
  );
  return (
    <li className={clsx('py-2', ticked && '-mx-2 rounded-lg bg-accent/6 px-2')}>
      <div className="flex items-start gap-2.5">
        {selection.enabled && (
          <input
            type="checkbox"
            checked={ticked}
            disabled={covered}
            // A checkbox changes on a click, so the event says whether shift was held.
            onChange={(event) => selection.toggle(entry, siblings, (event.nativeEvent as MouseEvent).shiftKey === true)}
            aria-label={`«${entry.name}» auswählen`}
            title={covered ? 'Mit dem Ordner darüber ausgewählt' : undefined}
            className="mt-1 size-4 shrink-0 accent-accent"
          />
        )}
        {folder ? (
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-start gap-2.5 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-accent">
            {body}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-start gap-2.5">{body}</div>
        )}
        {convertible && (
          <button
            type="button"
            onClick={() => conversions.open(entry)}
            title="Viele Geräte spielen Profil 8.1 direkt, Profil 7 aber nicht"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-card px-2.5 py-1 text-xs font-medium text-ink ring-1 ring-line transition hover:bg-card-2"
          >
            <WandSparkles className="size-3.5 text-accent" aria-hidden />
            <span className="hidden sm:inline">In Profil 8.1 umwandeln</span>
            <span className="sm:hidden">Umwandeln</span>
          </button>
        )}
      </div>
      {open && <FolderContent path={entry.path} now={now} />}
    </li>
  );
}

/** Profile 7 stands out: many players show it only as HDR10. */
function DolbyVisionBadge({ info }: { info: DolbyVisionInfo }) {
  return (
    <span
      title={describeDolbyVision(info)}
      className={clsx(
        'ml-2 inline-block rounded px-1.5 py-px align-[1px] text-[0.6875rem] font-semibold whitespace-nowrap',
        info.profile === 7 ? 'bg-warning/15 text-warning ring-1 ring-warning/30' : 'bg-card-2 text-ink-2 ring-1 ring-line',
      )}
    >
      {dolbyVisionLabel(info)}
    </span>
  );
}

/** Where the conversion of a file stands, or how it ended. */
function ConversionLine({ job, now }: { job: ConversionJob; now: number }) {
  const details = (
    <Link to="/conversions/overview" className="font-medium text-accent hover:underline">
      Details
    </Link>
  );
  if (isActive(job)) {
    const doing =
      job.state === 'running'
        ? joinParts([job.paused ? 'Pausiert' : 'Wird umgewandelt', job.step && STEP_LABELS[job.step], job.progress !== null && `${Math.round(job.progress * 100)} %`])
        : job.paused
          ? 'Umwandlung pausiert'
          : job.scheduled
            ? 'Umwandlung eingeplant'
            : 'Umwandlung wartet';
    return (
      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-2" role="status">
        <LoaderCircle className={clsx('size-3 shrink-0 text-accent', job.state === 'running' && !job.paused && 'animate-spin')} aria-hidden />
        <span className="min-w-0">
          {doing}
          {job.state === 'queued' && job.waitReason && ` – ${job.waitReason}`} · {details}
        </span>
      </span>
    );
  }
  if (job.state === 'canceled' || !job.finishedAt || now - Date.parse(job.finishedAt) > RECENT_MS) return null;
  const failed = job.state === 'failed';
  return (
    <span className={clsx('mt-0.5 flex items-start gap-1.5 text-xs', failed ? 'text-critical' : 'text-good')}>
      {failed ? <CircleX className="mt-px size-3 shrink-0" aria-hidden /> : <CircleCheck className="mt-px size-3 shrink-0" aria-hidden />}
      <span className="min-w-0">
        {failed ? `Umwandlung fehlgeschlagen: ${job.error ?? 'unbekannter Fehler'}` : `In Profil 8.1 umgewandelt ${formatAgo(Date.parse(job.finishedAt), now)}`}
        {job.warning && <span className="text-ink-2"> – {job.warning}</span>} · {details}
      </span>
    </span>
  );
}

/** A folder's content, read when it is opened. */
function FolderContent({ path, now }: { path: string; now: number }) {
  const folder = useExtracted(path, true);
  let content;
  if (folder.error) content = <p className="text-xs text-critical">{folder.error.message}</p>;
  else if (!folder.data) {
    content = (
      <p className="flex items-center gap-1.5 text-xs text-ink-2">
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> Wird gelesen …
      </p>
    );
  } else if (folder.data.entries.length === 0) content = <p className="text-xs text-ink-2">Leer.</p>;
  else {
    content = (
      <ul className="divide-y divide-line">
        {folder.data.entries.map((entry) => (
          <EntryRow key={entry.path} entry={entry} siblings={folder.data.entries} now={now} />
        ))}
      </ul>
    );
  }
  return <div className="mt-1 ml-2 border-l border-line pl-4">{content}</div>;
}

/** A move in progress with its rate, or its outcome. */
function MoveRow({ move, now }: { move: ExtractedMove; now: number }) {
  const names = move.paths.map(lastName);
  const what = names.length === 1 ? `«${names[0]}»` : `${names.length} Einträge`;
  if (move.state === 'queued' || move.state === 'running') {
    const share = move.bytesTotal > 0 ? Math.min(1, move.bytesDone / move.bytesTotal) : 0;
    return (
      <li className="rounded-xl bg-card-2/50 p-3 ring-1 ring-line" role="status">
        <p className="flex items-center gap-2">
          <LoaderCircle className="size-4 shrink-0 animate-spin text-accent" aria-hidden />
          <span className="min-w-0">
            {move.state === 'queued' ? 'Wartet:' : 'Verschiebt'} {what} nach <span className="font-medium">{move.label}</span>
          </span>
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-accent/15">
          <div className="bg-brand h-full rounded-full transition-[width]" style={{ width: `${Math.max(share * 100, 1)}%` }} />
        </div>
        <p className="mt-1 text-xs text-ink-2">
          {joinParts([
            `${Math.round(share * 100)} % von ${size(move.bytesTotal)}`,
            move.bytesPerSecond !== null && formatBitrate(move.bytesPerSecond * 8),
            move.copyThrottle && `höchstens ${formatBitrate(move.copyThrottle.bytesPerSecond * 8)}${move.copyThrottle.streams ? ', wegen Streams' : ''}`,
            move.scan && `danach Scan von «${move.scan.name}»`,
          ])}
        </p>
      </li>
    );
  }
  const failed = move.state === 'failed';
  return (
    <li className="text-xs">
      <p className="flex items-start gap-1.5">
        {failed ? <CircleX className="mt-px size-3.5 shrink-0 text-critical" aria-hidden /> : <CircleCheck className="mt-px size-3.5 shrink-0 text-good" aria-hidden />}
        <span className="min-w-0">
          {failed ? `${what} nicht nach ${move.label} verschoben` : `${what} nach ${move.label} verschoben`}
          {move.finishedAt && <span className="text-ink-3"> · {formatAgo(Date.parse(move.finishedAt), now)}</span>}
        </span>
      </p>
      {move.problems.map((problem) => (
        <p key={problem.path} className="mt-0.5 ml-5 text-critical">
          {lastName(problem.path)}: {problem.error}
        </p>
      ))}
      {move.scan && <MoveScanLine scan={move.scan} />}
    </li>
  );
}

/** What became of the scan after a move («Verschieben & scannen»). */
function MoveScanLine({ scan }: { scan: MoveScan }) {
  if (scan.state === 'waiting') {
    return (
      <p className="mt-0.5 ml-5 flex items-center gap-1.5 text-ink-2">
        <LoaderCircle className="size-3 animate-spin text-accent" aria-hidden /> Scan von «{scan.name}» wird gestartet …
      </p>
    );
  }
  if (scan.state === 'started') {
    return (
      <p className="mt-0.5 ml-5 flex items-center gap-1.5 text-ink-2">
        <FolderSearch className="size-3 text-accent" aria-hidden /> Jellyfin scannt «{scan.name}».
      </p>
    );
  }
  return (
    <p className="mt-0.5 ml-5 text-critical">
      Kein Scan von «{scan.name}»: {scan.error}
    </p>
  );
}

function readLastTarget(): string | null {
  try {
    return localStorage.getItem(LAST_TARGET_KEY);
  } catch {
    return null;
  }
}

/** Whether `path` is `folder` or lies in it; Windows paths in any case. */
function isInFolder(path: string, folder: string): boolean {
  const fold = (value: string) => value.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
  const [inner, outer] = [fold(path), fold(folder)];
  return inner === outer || inner.startsWith(`${outer}/`);
}

/** Lower case words only: "The.Expanse.S05" and "The Expanse (2015)" become comparable. */
const words = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The series the ticked entries most likely belong to: the longest series name their names start with. */
function guessSeries(series: LibrarySeries[], names: string[]): LibrarySeries | null {
  let best: LibrarySeries | null = null;
  for (const candidate of series) {
    const plain = words(candidate.name);
    const forms = [plain, words(candidate.name.replace(/\(\d{4}\)/, ''))];
    const fits = names.every((name) => forms.some((form) => form && (words(name) === form || words(name).startsWith(`${form} `))));
    if (fits && (!best || plain.length > words(best.name).length)) best = candidate;
  }
  return best;
}

/** For episode files of one season (S05E11 …), that season's folder, if the series has one. */
function guessSeason(seasons: SeriesSeason[], entries: Array<{ name: string; folder: boolean }>): SeriesSeason | null {
  if (entries.length === 0 || entries.some((entry) => entry.folder)) return null;
  const numbers = new Set(entries.map((entry) => Number(/s(\d{1,2})e\d{1,3}/i.exec(entry.name)?.[1] ?? NaN)));
  if (numbers.size !== 1) return null;
  const [number] = [...numbers];
  return seasons.find((season) => season.index === number) ?? null;
}

const fieldClass =
  'block w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-3 focus:ring-accent/20';

/**
 * Where the ticked entries go: a folder of a Jellyfin library – in a series library also into a series, and there
 * perhaps into one of its season folders, or into a new series folder named here. Series and seasons come from
 * Jellyfin, with the folders it has them in.
 */
function MoveForm({ selected, newFolders, onDone, onCancel }: { selected: Map<string, Ticked>; newFolders: boolean; onDone: () => void; onCancel: () => void }) {
  const libraries = useMediaLibraries(true);
  const move = useMoveExtracted();
  const options = (libraries.data ?? []).flatMap((library) => library.locations.map((location) => ({ library, location })));
  const remembered = readLastTarget();
  const [location, setLocation] = useState<string | null>(null);
  const chosen = location ?? (options.some((option) => option.location === remembered) ? remembered : null);
  const option = options.find((candidate) => candidate.location === chosen) ?? null;
  const seriesLibrary = option?.library.type === 'tvshows';

  const entries = [...selected].map(([path, ticked]) => ({ name: lastName(path), folder: ticked.folder }));
  const seriesList = useLibrarySeries(seriesLibrary && option?.library.id ? option.library.id : null);
  const series = (seriesList.data ?? []).filter((candidate) => chosen && isInFolder(candidate.path, chosen));
  // A choice counts for the folder it was made in; until then, the guess from the names.
  const [seriesChoice, setSeriesChoice] = useState<{ location: string | null; id: string } | null>(null);
  const seriesId = seriesChoice?.location === chosen ? seriesChoice.id : (guessSeries(series, entries.map((entry) => entry.name))?.id ?? '');
  const show = series.find((candidate) => candidate.id === seriesId) ?? null;
  const seasonList = useSeriesSeasons(show?.id ?? null);
  const seasons = seasonList.data ?? [];
  const [seasonChoice, setSeasonChoice] = useState<{ series: string; id: string } | null>(null);
  const seasonId = show ? (seasonChoice?.series === show.id ? seasonChoice.id : (guessSeason(seasons, entries)?.id ?? '')) : '';
  const season = seasons.find((candidate) => candidate.id === seasonId) ?? null;
  // A new series gets a folder of its own, named here; older agents put the entries right into the library.
  const newSeries = Boolean(chosen && seriesLibrary && seriesList.data && !show && newFolders);
  const [typedName, setTypedName] = useState<string | null>(null);
  const folderName = (typedName ?? guessSeriesName(entries.map((entry) => entry.name))).trim();
  const known = newSeries && folderName ? series.find((candidate) => [candidate.name, lastName(candidate.path.replace(/\\/g, '/'))].some((name) => words(name) === words(folderName))) : undefined;

  const target = newSeries ? (isFolderName(folderName) ? joinFolder(chosen!, folderName) : null) : (season?.path ?? show?.path ?? chosen);
  const paths = [...selected.keys()];
  const bytes = [...selected.values()].reduce((sum, value) => sum + value.bytes, 0);

  const ready = Boolean(chosen) && !move.isPending && !(seriesLibrary && !seriesList.data) && !(newSeries && !isFolderName(folderName));

  /** With `scan`, Jellyfin scans the series or season once the move is done. */
  function send(scan: boolean) {
    if (!chosen) return;
    move.mutate(
      {
        paths,
        target: chosen,
        ...(newSeries ? { newFolder: folderName } : season || show ? { itemId: (season ?? show)!.id, ...(scan ? { scan } : {}) } : {}),
      },
      {
        onSuccess: () => {
          try {
            localStorage.setItem(LAST_TARGET_KEY, chosen);
          } catch {
            // Only a convenience.
          }
          onDone();
        },
      },
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    send(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4 text-sm">
      <div className="rounded-xl bg-card-2/50 p-3 ring-1 ring-line">
        <p className="font-medium">
          {paths.length === 1 ? '1 Eintrag' : `${paths.length} Einträge`} · {size(bytes)}
        </p>
        <ul className="mt-1 text-xs text-ink-2">
          {paths.slice(0, 5).map((path) => (
            <li key={path} className="break-all">
              {path}
            </li>
          ))}
          {paths.length > 5 && <li>und {paths.length - 5} weitere</li>}
        </ul>
      </div>

      {libraries.error && <Message tone="critical">{libraries.error.message}</Message>}
      {!libraries.data && !libraries.error && <div aria-busy className="h-10 animate-pulse rounded-lg bg-card-2" />}
      {libraries.data && options.length === 0 && <p className="text-ink-2">Jellyfin hat keine Mediathek mit einem Ordner.</p>}
      {options.length > 0 && (
        <div>
          <label htmlFor="move-library" className="mb-1.5 block font-medium">
            Mediathek
          </label>
          <select id="move-library" value={chosen ?? ''} onChange={(event) => setLocation(event.target.value)} className={fieldClass}>
            {!chosen && (
              <option value="" disabled>
                Mediathek wählen …
              </option>
            )}
            {options.map(({ library, location: folder }) => (
              <option key={`${library.id ?? library.name}-${folder}`} value={folder}>
                {library.name} – {folder}
              </option>
            ))}
          </select>
        </div>
      )}

      {seriesLibrary && (
        <div>
          <label htmlFor="move-series" className="mb-1.5 block font-medium">
            Serie
          </label>
          {seriesList.error ? (
            <Message tone="critical">{seriesList.error.message}</Message>
          ) : (
            <SearchSelect
              id="move-series"
              pinned={{ value: '', label: newFolders ? 'Neue Serie …' : 'Keine – neu, direkt in die Mediathek' }}
              options={series.map((candidate) => ({ value: candidate.id, label: seriesLabel(candidate) }))}
              value={seriesId}
              onChange={(id) => setSeriesChoice({ location: chosen, id })}
              disabled={!seriesList.data}
              placeholder={seriesList.data ? 'Serie suchen …' : 'Serien werden geladen …'}
            />
          )}
          <p className="mt-1.5 text-xs text-ink-2">
            {show
              ? 'In den Ordner der Serie – einzelne Folgen oder ganze Staffelordner.'
              : newFolders
                ? 'Für eine neue Serie legt der Agent einen Ordner in der Mediathek an und verschiebt die Einträge hinein.'
                : 'Für eine neue Serie: Der Ordner kommt direkt in die Mediathek. Einen eigenen Serienordner anlegen geht ab Agent 0.28.0.'}
          </p>
        </div>
      )}

      {newSeries && (
        <div>
          <label htmlFor="move-folder" className="mb-1.5 block font-medium">
            Name des Serienordners
          </label>
          <input
            id="move-folder"
            value={typedName ?? folderName}
            onChange={(event) => setTypedName(event.target.value)}
            placeholder="z. B. Dark (2017)"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!isFolderName(folderName)}
            aria-describedby="move-folder-hint"
            className={fieldClass}
          />
          <p id="move-folder-hint" className={clsx('mt-1.5 text-xs', folderName && !isFolderName(folderName) ? 'text-critical' : 'text-ink-2')}>
            {!folderName
              ? 'Den Namen der Serie angeben, am besten mit Jahr – so findet Jellyfin sie sicher.'
              : !isFolderName(folderName)
                ? 'Ohne < > : " / \\ | ? * und nicht mit Punkt oder Leerzeichen am Ende.'
                : 'So heisst der neue Ordner in der Mediathek; am besten mit Jahr, so findet Jellyfin die Serie sicher.'}
          </p>
          {known && (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-warning/10 px-3 py-2 text-xs ring-1 ring-warning/30">
              <TriangleAlert className="size-3.5 shrink-0 text-warning" aria-hidden />
              <span>«{known.name}» gibt es in Jellyfin schon.</span>
              <button type="button" onClick={() => setSeriesChoice({ location: chosen, id: known.id })} className="font-medium text-accent hover:underline">
                Diese Serie wählen
              </button>
            </p>
          )}
        </div>
      )}

      {show && seasons.length > 0 && (
        <div>
          <label htmlFor="move-season" className="mb-1.5 block font-medium">
            Staffel
          </label>
          <select id="move-season" value={seasonId} onChange={(event) => setSeasonChoice({ series: show.id, id: event.target.value })} className={fieldClass}>
            <option value="">Keine – direkt in den Serienordner</option>
            {seasons.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-ink-2">Für Folgen einer bestehenden Staffel; ein ganzer Staffelordner gehört in den Serienordner.</p>
        </div>
      )}

      {target && (
        <p className="rounded-lg bg-card-2/50 px-3 py-2 text-xs ring-1 ring-line">
          <span className="text-ink-2">Ziel: </span>
          <span className="font-mono break-all">{target}</span>
          {newSeries && <span className="ml-2 rounded-full bg-accent/12 px-1.5 py-0.5 font-medium whitespace-nowrap text-accent">neuer Ordner</span>}
        </p>
      )}

      <p className="text-xs text-ink-3">
        Auf derselben Platte geht das sofort. Sonst kopiert der Agent – so schnell, wie das Kopier-Limit der Umwandlungen es während Streams erlaubt
        – und löscht erst danach im Entpack-Ordner. Was es am Ziel schon gibt, bleibt unangetastet.
      </p>
      {show && (
        <p className="text-xs text-ink-3">
          «Verschieben & scannen»: Ist das Verschieben fertig, scannt Jellyfin nur {season ? 'diese Staffel' : 'diese Serie'} – das übernimmt Manelly,
          auch wenn der Browser zu ist.
        </p>
      )}
      {move.isError && <Message tone="critical">{move.error.message}</Message>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className={button}>
          Abbrechen
        </button>
        <button type="submit" disabled={!ready} className={show ? button : primaryButton}>
          {move.isPending && move.variables?.scan !== true && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          Verschieben
        </button>
        {show && (
          <button type="button" onClick={() => send(true)} disabled={!ready} className={primaryButton}>
            {move.isPending && move.variables?.scan === true ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <FolderSearch className="size-4" aria-hidden />}
            Verschieben & scannen
          </button>
        )}
      </div>
    </form>
  );
}

/** The ticked entries, deleted for good after a look; what could not be deleted stays listed. */
function DeleteForm({ selected, onDone, onCancel }: { selected: Map<string, Ticked>; onDone: () => void; onCancel: () => void }) {
  const remove = useDeleteExtracted();
  const paths = [...selected.keys()];
  const bytes = [...selected.values()].reduce((sum, value) => sum + value.bytes, 0);
  const folders = [...selected.values()].filter((value) => value.folder).length;
  const result = remove.data;

  if (result) {
    return (
      <div className="space-y-4 text-sm">
        {result.deleted.length > 0 && (
          <Message tone="good">{result.deleted.length === 1 ? '1 Eintrag gelöscht.' : `${result.deleted.length} Einträge gelöscht.`}</Message>
        )}
        <div>
          <p className="font-medium">Nicht gelöscht</p>
          <ul className="mt-1 space-y-1 text-xs">
            {result.problems.map((problem) => (
              <li key={problem.path} className="break-all">
                <span className="text-ink">{problem.path}</span> <span className="text-critical">– {problem.error}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={onDone} className={button}>
            Schliessen
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      <p>
        <span className="font-medium">
          {paths.length === 1 ? '1 Eintrag' : `${paths.length} Einträge`} · {size(bytes)}
        </span>{' '}
        – {folders > 0 ? 'Ordner samt allem, was darin liegt. ' : ''}Das Löschen ist endgültig, es gibt keinen Papierkorb.
      </p>
      <ul className="max-h-48 overflow-y-auto rounded-xl bg-card-2/50 p-3 text-xs text-ink-2 ring-1 ring-line">
        {paths.map((path) => (
          <li key={path} className="flex items-start gap-1.5 break-all">
            {selected.get(path)?.folder ? <Folder className="mt-px size-3.5 shrink-0 text-accent" aria-hidden /> : <File className="mt-px size-3.5 shrink-0 text-ink-3" aria-hidden />}
            {path}
          </li>
        ))}
      </ul>
      {remove.isError && <Message tone="critical">{remove.error.message}</Message>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className={button}>
          Abbrechen
        </button>
        <button
          type="button"
          disabled={remove.isPending}
          onClick={() => remove.mutate(paths, { onSuccess: (answer) => answer.problems.length === 0 && onDone() })}
          className={dangerButton}
        >
          {remove.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />} Endgültig löschen
        </button>
      </div>
    </div>
  );
}

/**
 * Converts a file with Dolby Vision profile 7 into profile 8.1 before it goes into a library. The result takes the
 * file's place; the original goes to the backups of the work folder, or into «.manelly-backup» next to the file.
 */
function ConvertForm({ entry, info, directory, onClose }: { entry: ExtractedEntry; info: DolbyVisionInfo; directory: string; onClose: () => void }) {
  const id = useId();
  const status = useAgent().data?.status;
  const schedule = status?.schedule;
  const work = status?.work;
  const workUsable = Boolean(work?.directory) && !work?.error;
  const hasSchedule = schedule !== undefined && restricts(schedule);
  // The last choices of a conversion in this browser, also those from the media.
  const [saved] = useState(loadChoices);
  const available = { folders: [], work: workUsable, schedule: hasSchedule };
  const [initial] = useState(() => initialChoices(saved, available));
  const [inWork, setInWork] = useState(initial.work);
  const [scheduled, setScheduled] = useState(initial.scheduled);
  const convert = useConvertExtracted();
  const staged = inWork && workUsable;
  const parent = entry.path.split('/').slice(0, -1);
  const backup = joinFolder(directory, [...parent, '.manelly-backup'].join(directory.includes('\\') ? '\\' : '/'));

  if (convert.data) {
    return (
      <div className="space-y-4 text-sm">
        <Message tone="good">
          {convert.data.scheduled
            ? `Die Umwandlung ist eingeplant: Der Agent startet sie ${(schedule && describeSchedule(schedule)) ?? 'nach Zeitplan'}.`
            : 'Die Umwandlung ist gestartet.'}{' '}
          Bis sie fertig ist, bleibt «{entry.name}» im Entpack-Ordner – verschieben und löschen gehen erst danach.
        </Message>
        <div className="flex flex-wrap justify-end gap-2">
          <Link to="/conversions/overview" className={button}>
            Zu den Umwandlungen
          </Link>
          <button type="button" onClick={onClose} className={primaryButton}>
            Schliessen
          </button>
        </div>
      </div>
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    saveChoices(rememberedChoices({ mode: saved.mode ?? 'alongside', folder: saved.folder ?? null, work: inWork, scheduled }, saved, available));
    convert.mutate({ path: entry.path, ...(scheduled && hasSchedule ? { scheduled: true } : {}), ...(staged ? { work: true } : {}) });
  }

  return (
    <form onSubmit={submit} className="space-y-5 text-sm">
      <div>
        <p className="font-medium break-all">{entry.name}</p>
        <p className="mt-0.5 text-xs text-ink-2">{joinParts([size(entry.bytes), describeDolbyVision(info)])}</p>
        <p className="mt-2 text-ink-2">
          Viele Geräte spielen Profil 8.1 direkt, Profil 7 aber nicht. Der Agent löst die Videospur heraus, wandelt die Dolby-Vision-Daten mit
          dovi_tool in Profil 8.1 um und setzt die Datei mit allen Ton- und Untertitelspuren neu zusammen; das Bild wird nicht neu kodiert. Die
          neue Datei ersetzt das Original im Entpack-Ordner – danach kann sie in die Mediathek.
        </p>
      </div>

      {(work?.directory || schedule) && (
        <div className="grid gap-5 sm:grid-cols-2">
          {work?.directory && (
            <Choice
              id={`${id}-where`}
              label="Wo umwandeln"
              value={staged ? 'work' : 'direct'}
              onChange={(value) => setInWork(value === 'work')}
              options={[
                { value: 'work', label: 'Im Arbeitsordner', disabled: !workUsable },
                { value: 'direct', label: 'Direkt im Entpack-Ordner' },
              ]}
              description={
                work.error ??
                (staged
                  ? `Kopiert die Datei nach ${work.directory}, wandelt dort um und kopiert das Ergebnis zurück. Das Original bleibt dort, bis du es unter Umwandlungen → Backups löschst.`
                  : 'Liest und schreibt während der ganzen Umwandlung im Entpack-Ordner.')
              }
            />
          )}
          {schedule && (
            <Choice
              id={`${id}-when`}
              label="Wann"
              value={scheduled && hasSchedule ? 'scheduled' : 'now'}
              onChange={(value) => setScheduled(value === 'scheduled')}
              options={[
                { value: 'scheduled', label: 'Nach Zeitplan', disabled: !hasSchedule },
                { value: 'now', label: 'Sofort' },
              ]}
              description={
                !hasSchedule
                  ? 'Noch kein Zeitplan – einstellen unter Umwandlungen → Einstellungen.'
                  : scheduled
                    ? `Startet ${describeSchedule(schedule)} – bis dahin bleibt die Datei im Entpack-Ordner.`
                    : 'Startet gleich (oder nach der laufenden Umwandlung) und läuft auch weiter, wenn jemand streamt.'
              }
            />
          )}
        </div>
      )}

      <div className="space-y-1 rounded-lg bg-card-2 p-3 text-xs text-ink-2">
        <p>
          Backup des Originals: {staged ? 'im Arbeitsordner, unter Umwandlungen → Backups' : <span className="font-mono break-all">{backup}</span>}
        </p>
        {!staged && (
          <p>
            Jellyfin ignoriert diesen Ordner.{' '}
            {parent.length > 0
              ? 'Er liegt im Ordner der Datei und kommt beim Verschieben mit in die Mediathek – lösche ihn vorher, sobald das Ergebnis passt.'
              : 'Lösche ihn hier, sobald das Ergebnis passt.'}
          </p>
        )}
      </div>
      <p className="text-xs text-ink-3">
        {info.enhancementLayer &&
          'Die Datei hat einen Enhancement Layer: Ist es ein «FEL» (zusätzliche Bildinformation), geht diese verloren; bei «MEL» nichts. Welcher es ist, lässt sich aus der Datei nicht ablesen. '}
        Behalte das Original, bis du das Ergebnis geprüft hast.
      </p>
      {convert.isError && <Message tone="critical">{convert.error.message}</Message>}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={button}>
          Abbrechen
        </button>
        <button type="submit" disabled={convert.isPending} className={primaryButton}>
          {convert.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <WandSparkles className="size-4" aria-hidden />}
          {scheduled && hasSchedule ? 'Umwandlung einplanen' : 'Umwandlung starten'}
        </button>
      </div>
    </form>
  );
}

/** The samples found, ticked unless big; deleted after a look. */
function SamplesForm({ onClose }: { onClose: () => void }) {
  const samples = useExtractedSamples(true);
  const remove = useDeleteSamples();
  const [unticked, setUnticked] = useState<Set<string> | null>(null);

  if (samples.error) return <Message tone="critical">{samples.error.message}</Message>;
  if (!samples.data) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-2">
        <LoaderCircle className="size-4 animate-spin" aria-hidden /> Sucht im ganzen Entpack-Ordner …
      </p>
    );
  }

  if (remove.data) {
    const { deleted, problems } = remove.data;
    return (
      <div className="space-y-3 text-sm">
        <Message tone={problems.length ? 'critical' : 'good'}>
          {deleted.length === 1 ? '1 Sample gelöscht' : `${deleted.length} Samples gelöscht`}
          {problems.length > 0 && `, ${problems.length} nicht`}.
        </Message>
        {problems.length > 0 && (
          <ul className="space-y-1 text-xs text-critical">
            {problems.map((problem) => (
              <li key={problem.path}>
                {problem.path}: {problem.error}
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className={button}>
            Schliessen
          </button>
        </div>
      </div>
    );
  }

  const found = samples.data.samples;
  if (found.length === 0) {
    return (
      <div className="space-y-3 text-sm">
        <Message tone="good">Keine Samples im Entpack-Ordner.</Message>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className={button}>
            Schliessen
          </button>
        </div>
      </div>
    );
  }

  // Big files stay unticked until somebody ticks them: perhaps a film with "Sample" in its title.
  const off = unticked ?? new Set(found.filter((sample) => sample.bytes > BIG_SAMPLE_BYTES).map((sample) => sample.path));
  const chosen = found.filter((sample) => !off.has(sample.path));
  const toggle = (path: string) => {
    const next = new Set(off);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setUnticked(next);
  };

  return (
    <div className="space-y-4 text-sm">
      <ul className="max-h-[50dvh] divide-y divide-line overflow-y-auto rounded-xl ring-1 ring-line">
        {found.map((sample) => {
          const big = sample.bytes > BIG_SAMPLE_BYTES;
          return (
            <li key={sample.path}>
              <label className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-card-2/60">
                <input type="checkbox" checked={!off.has(sample.path)} onChange={() => toggle(sample.path)} className="mt-1 size-4 shrink-0 accent-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium break-all">{lastName(sample.path)}</span>
                  <span className="block text-xs break-all text-ink-3">{sample.path.includes('/') ? sample.path.slice(0, sample.path.lastIndexOf('/')) : 'im Entpack-Ordner'}</span>
                </span>
                <span className={clsx('flex shrink-0 items-center gap-1 text-xs tabular-nums', big ? 'font-medium text-warning' : 'text-ink-2')}>
                  {big && <TriangleAlert className="size-3.5" aria-hidden />}
                  {size(sample.bytes)}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {found.some((sample) => sample.bytes > BIG_SAMPLE_BYTES) && (
        <p className="flex gap-1.5 text-xs text-warning">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          Über 1 GB ist selten ein Sample – solche Dateien sind nicht angekreuzt. Nur ankreuzen, wenn es wirklich eines ist.
        </p>
      )}
      {remove.isError && <Message tone="critical">{remove.error.message}</Message>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={onClose} className={button}>
          Abbrechen
        </button>
        <button type="button" onClick={() => remove.mutate(chosen.map((sample) => sample.path))} disabled={chosen.length === 0 || remove.isPending} className={dangerButton}>
          {remove.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
          {chosen.length === 1 ? '1 Sample löschen' : `${chosen.length} Samples löschen`} · {size(chosen.reduce((sum, sample) => sum + sample.bytes, 0))}
        </button>
      </div>
    </div>
  );
}
