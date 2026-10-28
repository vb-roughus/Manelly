import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { CopyLimit, CopyLimitMode, WorkFolderStatus } from '@manelly/shared';
import { HardDrive, LoaderCircle } from 'lucide-react';
import { useSaveCopyLimit, useSaveWorkFolder } from '../hooks/queries';
import { formatBytes } from '../lib/format';

/**
 * A folder on a fast disk of the Jellyfin server: conversions copy the original there, convert there and copy the
 * result back – the storage is busy only while copying. Manelly names the folder; the agent checks it.
 */
export function WorkFolderPanel({ work }: { work: WorkFolderStatus }) {
  const id = useId();
  const save = useSaveWorkFolder();
  // Up here, so the confirmation survives the fresh form after saving.
  const saveLimit = useSaveCopyLimit();
  const [directory, setDirectory] = useState(work.directory ?? '');
  const changed = directory.trim() !== (work.directory ?? '');

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate(directory.trim() || null);
  }

  return (
    <section className="rounded-2xl border border-line bg-card p-4 text-sm" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="flex items-center gap-2 font-semibold">
        <HardDrive className="size-4 text-accent" aria-hidden />
        Arbeitsordner
      </h2>
      <p className="mt-1 text-ink-2">
        Ein Ordner auf einer schnellen Platte des Jellyfin-Servers. Umwandlungen kopieren das Original dorthin, wandeln dort um und
        kopieren das Ergebnis zurück – der Speicher, auf dem die Filme liegen, wird so nur beim Kopieren belastet. Wählbar im
        Umwandlungsdialog.
      </p>

      <form onSubmit={submit}>
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
          <button type="submit" disabled={!changed || save.isPending} className={primaryButton}>
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

      {work.directory &&
        // Missing on agents before 0.21.0; in MB/s before 0.23.0.
        (typeof work.copyLimit?.limitMbps === 'number' ? (
          <CopyLimitForm key={JSON.stringify(work.copyLimit)} limit={work.copyLimit} save={saveLimit} />
        ) : (
          <p className="mt-4 border-t border-line pt-3 text-xs text-ink-3">
            Das Kopieren begrenzen in Mbit/s geht ab Agent 0.23.0 – unter{' '}
            <Link to="/server/agent" className="font-medium text-accent hover:underline">
              Server → Agent
            </Link>{' '}
            «Aktualisieren & neu starten».
          </p>
        ))}
    </section>
  );
}

const MODES: Array<{ mode: CopyLimitMode; label: string }> = [
  { mode: 'off', label: 'Nicht begrenzen' },
  { mode: 'streaming', label: 'Automatisch während Streams' },
  { mode: 'always', label: 'Immer' },
];

/** In Mbit/s, up to 100 Gbit/s. */
const MAX_MBPS = 100_000;
const isRate = (value: number) => Number.isInteger(value) && value >= 1 && value <= MAX_MBPS;

/** How fast conversions may copy to and from the work folder, so streams still get enough from the storage. */
function CopyLimitForm({ limit, save }: { limit: CopyLimit; save: ReturnType<typeof useSaveCopyLimit> }) {
  const id = useId();
  const [mode, setMode] = useState(limit.mode);
  const [limitMbps, setLimitMbps] = useState(String(limit.limitMbps));
  const [storageMbps, setStorageMbps] = useState(String(limit.storageMbps));
  // The field this mode uses; the other one keeps what was saved.
  const field = mode === 'always' ? Number(limitMbps) : mode === 'streaming' ? Number(storageMbps) : null;
  const valid = field === null || isRate(field);
  const changed = mode !== limit.mode || (mode === 'always' && field !== limit.limitMbps) || (mode === 'streaming' && field !== limit.storageMbps);

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate({
      mode,
      limitMbps: mode === 'always' ? Number(limitMbps) : limit.limitMbps,
      storageMbps: mode === 'streaming' ? Number(storageMbps) : limit.storageMbps,
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 border-t border-line pt-3" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`} className="font-medium">
        Kopieren begrenzen
      </h3>
      <p className="mt-0.5 text-xs text-ink-2">
        Damit Streams genug vom Speicher bekommen, während eine Umwandlung das Original holt oder das Ergebnis zurückbringt. Gilt nur
        fürs Kopieren – «Direkt am Speicherort» lässt sich nicht begrenzen.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-mode`} className="sr-only">
          Wann begrenzen
        </label>
        <select id={`${id}-mode`} value={mode} onChange={(event) => setMode(event.target.value as CopyLimitMode)} className={fieldClass}>
          {MODES.map((entry) => (
            <option key={entry.mode} value={entry.mode}>
              {entry.label}
            </option>
          ))}
        </select>
        {mode === 'streaming' && (
          <label className="flex items-center gap-1.5 text-sm text-ink-2">
            Speicher schafft
            <RateInput value={storageMbps} onChange={setStorageMbps} label="Was der Speicher insgesamt schafft, in Mbit/s" />
            Mbit/s
          </label>
        )}
        {mode === 'always' && (
          <label className="flex items-center gap-1.5 text-sm text-ink-2">
            auf
            <RateInput value={limitMbps} onChange={setLimitMbps} label="Höchstens Mbit/s" />
            Mbit/s
          </label>
        )}
        <button type="submit" disabled={!changed || !valid || save.isPending} className={primaryButton}>
          {save.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          Speichern
        </button>
      </div>
      {mode === 'streaming' && (
        <p className="mt-1.5 text-xs text-ink-3">
          Solange jemand streamt, kopiert der Agent höchstens mit: was der Speicher schafft − Bitrate der laufenden Streams − 20 Mbit/s
          Reserve. Ohne Streams mit voller Geschwindigkeit. Was dein Speicher schafft, zeigt bei einer laufenden Umwandlung im Arbeitsordner
          die «Auslastung der Storage-Schnittstelle» unter «Zusammen».
        </p>
      )}
      {!valid && <p className="mt-1.5 text-xs text-critical">Ganze Mbit/s zwischen 1 Mbit/s und 100 Gbit/s (100000).</p>}
      {save.isError && <p className="mt-2 text-xs text-critical">{save.error.message}</p>}
      {save.isSuccess && !changed && <p className="mt-2 text-xs text-good">Gespeichert.</p>}
    </form>
  );
}

function RateInput({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <input
      type="number"
      min={1}
      max={MAX_MBPS}
      step={1}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      className={`${fieldClass} w-24 tabular-nums`}
    />
  );
}

const fieldClass =
  'rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-3 focus:ring-accent/20';
const primaryButton =
  'bg-brand inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50';
