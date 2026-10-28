import { useId, useState, type FormEvent } from 'react';
import type { WorkFolderStatus } from '@manelly/shared';
import { HardDrive, LoaderCircle } from 'lucide-react';
import { useSaveWorkFolder } from '../hooks/queries';
import { formatBytes } from '../lib/format';

/**
 * A folder on a fast disk of the Jellyfin server: conversions copy the original there, convert there and copy the
 * result back – the storage is busy only while copying. Manelly names the folder; the agent checks it.
 */
export function WorkFolderPanel({ work }: { work: WorkFolderStatus }) {
  const id = useId();
  const save = useSaveWorkFolder();
  const [directory, setDirectory] = useState(work.directory ?? '');
  const changed = directory.trim() !== (work.directory ?? '');

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate(directory.trim() || null);
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-line bg-card p-4 text-sm" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="flex items-center gap-2 font-semibold">
        <HardDrive className="size-4 text-accent" aria-hidden />
        Arbeitsordner
      </h2>
      <p className="mt-1 text-ink-2">
        Ein Ordner auf einer schnellen Platte des Jellyfin-Servers. Umwandlungen kopieren das Original dorthin, wandeln dort um und
        kopieren das Ergebnis zurück – der Speicher, auf dem die Filme liegen, wird so nur beim Kopieren belastet. Wählbar im
        Umwandlungsdialog.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-directory`} className="sr-only">
          Arbeitsordner auf dem Jellyfin-Server
        </label>
        <input
          id={`${id}-directory`}
          value={directory}
          onChange={(event) => setDirectory(event.target.value)}
          placeholder="z. B. E:\Manelly"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-line bg-card px-2.5 py-1.5 font-mono text-sm text-ink outline-none placeholder:font-sans focus:border-accent focus:ring-3 focus:ring-accent/20"
        />
        <button
          type="submit"
          disabled={!changed || save.isPending}
          className="bg-brand inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {save.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          {directory.trim() || !work.directory ? 'Speichern' : 'Ausschalten'}
        </button>
      </div>
      <p className="mt-1.5 text-xs text-ink-3">Den Ordner zuerst auf dem Server anlegen. Leer lassen und speichern schaltet ihn aus.</p>

      {work.directory && !changed && (
        <p className={work.error ? 'mt-2 text-xs text-critical' : 'mt-2 text-xs text-ink-2'}>
          {work.error ?? `Frei: ${work.freeBytes === null ? 'unbekannt' : formatBytes(work.freeBytes)} – eine Umwandlung braucht dort etwa das Dreifache der Filmgrösse.`}
        </p>
      )}
      {save.isError && <p className="mt-2 text-xs text-critical">{save.error.message}</p>}
      {save.isSuccess && !changed && !work.error && <p className="mt-2 text-xs text-good">Gespeichert.</p>}
    </form>
  );
}
