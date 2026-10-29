import { createContext, useContext, useState, type FormEvent } from 'react';
import type { ExtractedEntry, ExtractedMove, LibrarySeries, SeriesSeason } from '@manelly/shared';
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
  LoaderCircle,
  RefreshCw,
  ScanSearch,
  Settings,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import {
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
import { guessSeriesName, isFolderName, joinFolder, VIDEO } from '../lib/extracted';
import { formatAgo, formatBitrate, formatBytes, joinParts } from '../lib/format';
import { range } from '../lib/packageSelection';
import { Message } from './ConnectionForm';
import { Modal } from './Modal';
import { keepTextOnShift } from './Tick';

const TEXT = /\.(nfo|txt|srt|ass|ssa|sub|idx|sfv|md5)$/i;
/** Bigger than any sample usually is; such a file is not ticked for deleting by itself. */
const BIG_SAMPLE_BYTES = 1024 ** 3;
const LAST_TARGET_KEY = 'manelly.extracted.target';
/** Finished moves stay in sight this long. */
const RECENT_MOVE_MS = 6 * 3_600_000;

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

/**
 * What lies in the folder JDownloader extracts into: newest first, folders open to show what is in them. Ticked
 * entries go into a library; samples can be looked for and deleted. The agent reads only that folder, and only while
 * this list is open.
 */
export function ExtractedList({ onOpenSettings, actions, newFolders }: { onOpenSettings: () => void; actions: boolean; newFolders: boolean }) {
  const root = useExtracted('', true, 60_000);
  const moves = useExtractedMoves(actions);
  const now = useNow(60_000);
  const [selected, setSelected] = useState<Map<string, Ticked>>(new Map());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'move' | 'samples' | null>(null);

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
  const recentMoves = (moves.data ?? []).filter((move) => !move.finishedAt || now - Date.parse(move.finishedAt) < RECENT_MOVE_MS).slice(0, 4);

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
              <span className="text-xs text-ink-3">Ordner oder Dateien ankreuzen, um sie in eine Mediathek zu verschieben.</span>
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
          <ul className="mt-3 divide-y divide-line border-t border-line" onMouseDown={keepTextOnShift}>
            {entries.map((entry) => (
              <EntryRow key={entry.path} entry={entry} siblings={entries} now={now} />
            ))}
          </ul>
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
      <Modal
        open={dialog === 'samples'}
        onClose={() => setDialog(null)}
        icon={ScanSearch}
        title="Samples suchen"
        description="Alle Dateien mit «sample» im Namen, im ganzen Entpack-Ordner. Prüfen, abwählen, was bleiben soll, dann löschen."
      >
        <SamplesForm onClose={() => setDialog(null)} />
      </Modal>
    </SelectionContext.Provider>
  );
}

function EntryRow({ entry, siblings, now }: { entry: ExtractedEntry; siblings: ExtractedEntry[]; now: number }) {
  const [open, setOpen] = useState(false);
  const selection = useContext(SelectionContext);
  const Icon = iconFor(entry, open);
  const folder = entry.kind === 'directory';
  const covered = coveredBy(selection.selected, entry.path);
  const ticked = covered || selection.selected.has(entry.path);
  const body = (
    <>
      <Icon className={clsx('mt-0.5 size-4 shrink-0', folder ? 'text-accent' : VIDEO.test(entry.name) ? 'text-ink' : 'text-ink-3')} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block font-medium break-words">{entry.name}</span>
        <span className="block text-xs text-ink-2">{details(entry, now)}</span>
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
      </div>
      {open && <FolderContent path={entry.path} now={now} />}
    </li>
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
    </li>
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

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!chosen) return;
    move.mutate(
      { paths, target: chosen, ...(newSeries ? { newFolder: folderName } : season || show ? { itemId: (season ?? show)!.id } : {}) },
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
            <select
              id="move-series"
              value={seriesId}
              onChange={(event) => setSeriesChoice({ location: chosen, id: event.target.value })}
              disabled={!seriesList.data}
              className={fieldClass}
            >
              <option value="">{!seriesList.data ? 'Serien werden geladen …' : newFolders ? 'Neue Serie …' : 'Keine – neu, direkt in die Mediathek'}</option>
              {series.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                  {candidate.year && !candidate.name.includes(String(candidate.year)) ? ` (${candidate.year})` : ''}
                </option>
              ))}
            </select>
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
      {move.isError && <Message tone="critical">{move.error.message}</Message>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className={button}>
          Abbrechen
        </button>
        <button type="submit" disabled={!chosen || move.isPending || (seriesLibrary && !seriesList.data) || (newSeries && !isFolderName(folderName))} className={primaryButton}>
          {move.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          Verschieben
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
