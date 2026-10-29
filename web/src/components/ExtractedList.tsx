import { createContext, useContext, useState, type FormEvent } from 'react';
import type { ExtractedEntry, ExtractedMove, MediaLibrary } from '@manelly/shared';
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
import { useDeleteSamples, useExtracted, useExtractedMoves, useExtractedSamples, useMediaLibraries, useMoveExtracted } from '../hooks/queries';
import { useNow } from '../hooks/useNow';
import { formatAgo, formatBitrate, formatBytes, joinParts } from '../lib/format';
import { LIBRARY_TYPE_LABELS } from '../lib/media';
import { Message } from './ConnectionForm';
import { Modal } from './Modal';

const VIDEO = /\.(mkv|mp4|m4v|avi|mov|wmv|ts|m2ts|mts|iso|webm)$/i;
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

/** The ticked entries, by path with their size; a ticked folder covers everything in it. */
interface Selection {
  enabled: boolean;
  selected: Map<string, number>;
  toggle: (entry: ExtractedEntry) => void;
}

const SelectionContext = createContext<Selection>({ enabled: false, selected: new Map(), toggle: () => {} });

const coveredBy = (selected: Map<string, number>, path: string) => [...selected.keys()].some((other) => path.startsWith(`${other}/`));

/**
 * What lies in the folder JDownloader extracts into: newest first, folders open to show what is in them. Ticked
 * entries go into a library; samples can be looked for and deleted. The agent reads only that folder, and only while
 * this list is open.
 */
export function ExtractedList({ onOpenSettings, actions }: { onOpenSettings: () => void; actions: boolean }) {
  const root = useExtracted('', true, 60_000);
  const moves = useExtractedMoves(actions);
  const now = useNow(60_000);
  const [selected, setSelected] = useState<Map<string, number>>(new Map());
  const [dialog, setDialog] = useState<'move' | 'samples' | null>(null);

  function toggle(entry: ExtractedEntry) {
    const next = new Map(selected);
    if (next.has(entry.path)) next.delete(entry.path);
    else {
      // Ticking a folder takes in what was ticked inside it.
      for (const path of next.keys()) if (path.startsWith(`${entry.path}/`)) next.delete(path);
      next.set(entry.path, entry.bytes);
    }
    setSelected(next);
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
  const selectedBytes = [...selected.values()].reduce((sum, bytes) => sum + bytes, 0);
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
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {entries.map((entry) => (
              <EntryRow key={entry.path} entry={entry} now={now} />
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

function EntryRow({ entry, now }: { entry: ExtractedEntry; now: number }) {
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
            onChange={() => selection.toggle(entry)}
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
          <EntryRow key={entry.path} entry={entry} now={now} />
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

/** Where the ticked entries go: one folder of a Jellyfin library, with its path. */
function MoveForm({ selected, onDone, onCancel }: { selected: Map<string, number>; onDone: () => void; onCancel: () => void }) {
  const libraries = useMediaLibraries(true);
  const move = useMoveExtracted();
  const options = (libraries.data ?? []).flatMap((library) => library.locations.map((location) => ({ library, location })));
  const remembered = readLastTarget();
  const [target, setTarget] = useState<string | null>(null);
  const chosen = target ?? (options.some((option) => option.location === remembered) ? remembered : null);
  const paths = [...selected.keys()];
  const bytes = [...selected.values()].reduce((sum, value) => sum + value, 0);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!chosen) return;
    move.mutate(
      { paths, target: chosen },
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

      <fieldset>
        <legend className="mb-2 font-medium">Wohin?</legend>
        {libraries.error && <Message tone="critical">{libraries.error.message}</Message>}
        {!libraries.data && !libraries.error && <div aria-busy className="h-24 animate-pulse rounded-xl bg-card-2" />}
        {libraries.data && options.length === 0 && <p className="text-ink-2">Jellyfin hat keine Mediathek mit einem Ordner.</p>}
        <div className="space-y-2">
          {options.map(({ library, location }) => (
            <LibraryOption key={`${library.id ?? library.name}-${location}`} library={library} location={location} checked={chosen === location} onChange={() => setTarget(location)} />
          ))}
        </div>
      </fieldset>

      <p className="text-xs text-ink-3">
        Auf derselben Platte geht das sofort. Sonst kopiert der Agent – so schnell, wie das Kopier-Limit der Umwandlungen es während Streams erlaubt
        – und löscht erst danach im Entpack-Ordner. Was es am Ziel schon gibt, bleibt unangetastet.
      </p>
      {move.isError && <Message tone="critical">{move.error.message}</Message>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className={button}>
          Abbrechen
        </button>
        <button type="submit" disabled={!chosen || move.isPending} className={primaryButton}>
          {move.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          Verschieben
        </button>
      </div>
    </form>
  );
}

function LibraryOption({ library, location, checked, onChange }: { library: MediaLibrary; location: string; checked: boolean; onChange: () => void }) {
  const type = LIBRARY_TYPE_LABELS[library.type ?? 'mixed'] ?? library.type;
  return (
    <label className={clsx('flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 transition', checked ? 'bg-accent/8 ring-accent/50' : 'ring-line hover:bg-card-2/60')}>
      <input type="radio" name="extracted-target" checked={checked} onChange={onChange} className="mt-1 accent-accent" />
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3">
        <span>
          <span className="font-medium">{library.name}</span>
          {type && type.toLowerCase() !== library.name.toLowerCase() && <span className="text-xs text-ink-3"> · {type}</span>}
        </span>
        <span className="font-mono text-xs break-all text-ink-2">{location}</span>
      </span>
    </label>
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
