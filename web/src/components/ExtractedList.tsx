import { useState } from 'react';
import type { ExtractedEntry } from '@manelly/shared';
import { ChevronDown, File, FileText, Film, Folder, FolderOpen, LoaderCircle, RefreshCw, Settings, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { useExtracted } from '../hooks/queries';
import { useNow } from '../hooks/useNow';
import { formatAgo, formatBytes, joinParts } from '../lib/format';
import { Message } from './ConnectionForm';

const VIDEO = /\.(mkv|mp4|m4v|avi|mov|wmv|ts|m2ts|mts|iso|webm)$/i;
const TEXT = /\.(nfo|txt|srt|ass|ssa|sub|idx|sfv|md5)$/i;

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

function details(entry: ExtractedEntry, now: number): string {
  const atLeast = entry.complete ? '' : 'mind. ';
  return joinParts([
    `${atLeast}${size(entry.bytes)}`,
    entry.files !== null && `${atLeast}${entry.files} ${entry.files === 1 ? 'Datei' : 'Dateien'}`,
    when(entry.updatedAt, now),
  ]);
}

/**
 * What lies in the folder JDownloader extracts into: newest first, folders open to show what is in them. The agent
 * reads only that folder, and only while this list is open.
 */
export function ExtractedList({ onOpenSettings }: { onOpenSettings: () => void }) {
  const root = useExtracted('', true, 60_000);
  const now = useNow(60_000);

  if (root.error) return <Message tone="critical">{root.error.message}</Message>;
  if (!root.data) return <div aria-busy className="h-48 animate-pulse rounded-2xl bg-card-2" />;
  const { directory, entries, freeBytes, error } = root.data;

  if (!directory) {
    return (
      <div className="rounded-2xl border border-line bg-card p-4 text-sm shadow-sm shadow-black/5 sm:p-5">
        <p className="font-medium">Noch kein Entpack-Ordner festgelegt</p>
        <p className="mt-1 text-ink-2">In den Einstellungen den Ordner angeben, in den JDownloader die Archive entpackt – hier steht dann, was darin liegt.</p>
        <button
          type="button"
          onClick={onOpenSettings}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-ink ring-1 ring-line transition hover:bg-card-2"
        >
          <Settings className="size-4" aria-hidden /> Einstellungen öffnen
        </button>
      </div>
    );
  }

  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  return (
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
  );
}

function EntryRow({ entry, now }: { entry: ExtractedEntry; now: number }) {
  const [open, setOpen] = useState(false);
  const Icon = iconFor(entry, open);
  const folder = entry.kind === 'directory';
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
    <li className="py-2">
      {folder ? (
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-start gap-2.5 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-accent">
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-2.5">{body}</div>
      )}
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
