import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { AgentScheduleStatus, ConversionOptions, ConversionOutputMode, StartConversionRequest } from '@manelly/shared';
import { CircleCheck, HardDrive, LoaderCircle, TriangleAlert, WandSparkles, X } from 'lucide-react';
import clsx from 'clsx';
import { useAgent, useConversionOptions, useStartConversion } from '../../hooks/queries';
import { formatBytes } from '../../lib/format';
import { initialChoices, loadChoices, rememberedChoices, saveChoices } from '../../lib/convertChoices';
import { describeSchedule, restricts } from '../../lib/schedule';

interface ConvertDialogProps {
  open: boolean;
  itemId: string;
  mediaSourceId: string | null;
  onClose: () => void;
}

/** Converts a Dolby Vision profile 7 file to profile 8.1 on the Jellyfin server, via the agent. */
export function ConvertDialog({ open, onClose, ...props }: ConvertDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      // Opened from the detail dialog: keep its close and click handlers out of this one.
      onClose={(event) => {
        event.stopPropagation();
        onClose();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === dialog.current) onClose();
      }}
      aria-labelledby="convert-heading"
      className="m-auto max-h-[90dvh] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-line bg-card p-0 text-ink shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      {open && <ConvertBody onClose={onClose} {...props} />}
    </dialog>
  );
}

function ConvertBody({ itemId, mediaSourceId, onClose }: Omit<ConvertDialogProps, 'open'>) {
  const options = useConversionOptions(itemId, mediaSourceId, true);
  const agent = useAgent();
  const schedule = agent.data?.status?.schedule;
  const start = useStartConversion();
  const waits = start.data?.scheduled === true;

  return (
    <div className="p-6">
      <div className="mb-3 flex items-start justify-between gap-4">
        <h2 id="convert-heading" className="flex items-center gap-2.5 text-lg font-semibold">
          <span className="grid size-8 place-items-center rounded-lg bg-accent/12 text-accent">
            <WandSparkles className="size-4" aria-hidden />
          </span>
          In Dolby Vision Profil 8.1 umwandeln
        </h2>
        <button type="button" onClick={onClose} aria-label="Schliessen" className="grid size-8 place-items-center rounded-lg text-ink-2 hover:bg-card-2 hover:text-ink">
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {options.isPending && <div aria-busy className="h-72 animate-pulse rounded-xl bg-card-2" />}
      {options.error && (
        <Note tone="critical">
          {options.error.message}{' '}
          <Link to="/server/agent" onClick={onClose} className="font-medium underline">
            Zum Agent
          </Link>
        </Note>
      )}
      {start.isSuccess ? (
        <div className="space-y-4">
          <Note tone="good">
            {waits ? (
              <>
                Die Umwandlung von <b>{start.data.title}</b> ist eingeplant: Der Agent startet sie {schedule ? describeSchedule(schedule) : 'nach Zeitplan'} –
                auch nach einem Neustart des Servers und wenn Manelly nicht läuft.
              </>
            ) : (
              <>
                Die Umwandlung von <b>{start.data.title}</b> ist gestartet. Sie läuft auf dem Jellyfin-Server weiter, auch wenn du Manelly
                schliesst.
              </>
            )}{' '}
            Danach erfährt Jellyfin von der neuen Datei.
          </Note>
          <div className="flex flex-wrap gap-2">
            <Link to="/conversions/overview" onClick={onClose} className={primaryButton}>
              Zu den Umwandlungen
            </Link>
            <button type="button" onClick={onClose} className={secondaryButton}>
              Schliessen
            </button>
          </div>
        </div>
      ) : (
        options.data && (
          <ConvertForm options={options.data} schedule={schedule} pending={start.isPending} error={start.error?.message ?? null} onStart={start.mutate} onCancel={onClose} />
        )
      )}
    </div>
  );
}

/** The separator Jellyfin's paths use: "\" on Windows. */
const separatorOf = (path: string) => (path.includes('\\') ? '\\' : '/');
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const join = (...parts: string[]) => {
  const separator = separatorOf(parts[0] ?? '');
  return parts.filter(Boolean).map((part, index) => (index === 0 ? part.replace(/[\\/]+$/, '') : part)).join(separator);
};
const stem = (name: string) => name.replace(/\.[^.]+$/, '');
const validName = (name: string) => /\.mkv$/i.test(name) && !/[<>:"/\\|?*]/.test(name) && !/[ .]$/.test(stem(name));

interface ConvertFormProps {
  options: ConversionOptions;
  /** Missing on agents before 0.2.0, which start everything right away. */
  schedule: AgentScheduleStatus | undefined;
  pending: boolean;
  error: string | null;
  onStart: (request: StartConversionRequest) => void;
  onCancel: () => void;
}

function ConvertForm({ options, schedule, pending, error, onStart, onCancel }: ConvertFormProps) {
  const id = useId();
  const hasSchedule = schedule !== undefined && restricts(schedule);
  const work = options.work;
  const workUsable = work !== null && work.error === null;
  // The last choices from this browser, as far as they fit this title and agent.
  const [saved] = useState(loadChoices);
  const available = { folders: options.folders.map((candidate) => candidate.path), work: workUsable, schedule: hasSchedule };
  const [initial] = useState(() => initialChoices(saved, available));
  const original = baseName(options.source.path);
  const [mode, setMode] = useState<ConversionOutputMode>(initial.mode);
  const [alongsideName, setAlongsideName] = useState(options.alongside.fileName);
  const [folder, setFolder] = useState(initial.folder ?? '');
  const [subfolder, setSubfolder] = useState(options.subfolder);
  const [folderName, setFolderName] = useState(`${stem(original)}.mkv`);
  // In the work folder, the storage is busy only while copying.
  const [inWork, setInWork] = useState(initial.work);
  const [scheduled, setScheduled] = useState(initial.scheduled);
  const staged = inWork && workUsable;

  const chosenFolder = options.folders.find((candidate) => candidate.path === folder);
  const target =
    mode === 'alongside' ? join(options.alongside.directory, alongsideName) : mode === 'replace' ? options.replace.path : join(folder, subfolder.trim(), folderName);
  const free = mode === 'folder' ? (chosenFolder?.freeBytes ?? null) : options.alongside.freeBytes;
  const targetNeeds = staged ? work.targetBytes : options.requiredBytes;
  const tooLittleSpace = free !== null && targetNeeds !== null && free < targetNeeds;
  const tooLittleWorkSpace = staged && work.freeBytes !== null && work.requiredBytes !== null && work.freeBytes < work.requiredBytes;
  const name = mode === 'alongside' ? alongsideName : mode === 'folder' ? folderName : original;
  const nameInvalid = mode !== 'replace' && !validName(name.trim());

  function submit(event: FormEvent) {
    event.preventDefault();
    const output: StartConversionRequest['output'] =
      mode === 'alongside'
        ? { mode, fileName: alongsideName.trim() }
        : mode === 'replace'
          ? { mode }
          : { mode, directory: folder, fileName: folderName.trim(), ...(subfolder.trim() ? { subfolder: subfolder.trim() } : {}) };
    saveChoices(rememberedChoices({ mode, folder: folder || null, work: inWork, scheduled }, saved, available));
    onStart({
      itemId: options.item.id,
      ...(options.source.mediaSourceId ? { mediaSourceId: options.source.mediaSourceId } : {}),
      output,
      ...(scheduled && hasSchedule ? { scheduled: true } : {}),
      ...(staged ? { work: true } : {}),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="text-sm">
        <p className="font-medium">
          {options.item.name}
          {options.item.year && <span className="font-normal text-ink-2"> ({options.item.year})</span>}
        </p>
        <p className="mt-0.5 font-mono text-xs break-all text-ink-2">{options.source.path}</p>
        <p className="mt-2 text-ink-2">
          Der Agent löst die Videospur heraus, wandelt die Dolby-Vision-Daten mit dovi_tool in Profil 8.1 um und setzt die Datei mit
          allen Ton- und Untertitelspuren neu zusammen. Das Bild wird nicht neu kodiert; der Enhancement Layer fällt weg.
        </p>
      </div>

      <Choice
        id={`${id}-mode`}
        label="Speichern"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'alongside', label: 'Neben dem Original' },
          { value: 'replace', label: 'Original ersetzen' },
          { value: 'folder', label: options.folders.length ? 'Anderer Ordner' : 'Anderer Ordner (keine Bibliotheksordner)', disabled: options.folders.length === 0 },
        ]}
        description={
          mode === 'alongside'
            ? 'Neue Datei im selben Ordner. Jellyfin zeigt beide als Versionen desselben Films.'
            : mode === 'replace'
              ? staged
                ? 'Die umgewandelte Datei kommt an die Stelle des Originals. Das Original bleibt im Arbeitsordner statt auf dem Speicher, bis du es unter Umwandlungen → Backups löschst.'
                : 'Die umgewandelte Datei kommt an die Stelle des Originals. Das Original wird verschoben, nicht gelöscht – Jellyfin ignoriert den Backup-Ordner.'
              : 'In einen Ordner einer Jellyfin-Bibliothek, z. B. eine eigene UHD-Bibliothek.'
        }
      >
        {mode === 'alongside' && <TextInput label="Dateiname" value={alongsideName} onChange={setAlongsideName} />}
        {mode === 'replace' && (
          <p className="text-xs text-ink-2">
            Backup: <span className="font-mono break-all">{staged ? work.backup : options.replace.backup}</span>
          </p>
        )}
        {mode === 'folder' && (
          <>
            <label className="block text-xs">
              <span className="mb-1 block text-ink-2">Bibliotheksordner</span>
              <select value={folder} onChange={(event) => setFolder(event.target.value)} className={fieldClass}>
                {options.folders.map((candidate) => (
                  <option key={candidate.path} value={candidate.path}>
                    {candidate.library} – {candidate.path}
                    {candidate.freeBytes === null ? ' (vom Agent aus nicht erreichbar)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <TextInput label="Unterordner (wird angelegt, falls nötig)" value={subfolder} onChange={setSubfolder} />
            <TextInput label="Dateiname" value={folderName} onChange={setFolderName} />
          </>
        )}
      </Choice>

      {(work || schedule) && (
        <div className="grid gap-5 sm:grid-cols-2">
          {work && (
            <Choice
              id={`${id}-where`}
              label="Wo umwandeln"
              value={staged ? 'work' : 'direct'}
              onChange={(value) => setInWork(value === 'work')}
              options={[
                { value: 'work', label: 'Im Arbeitsordner', disabled: !workUsable },
                { value: 'direct', label: 'Direkt am Speicherort' },
              ]}
              description={
                work.error ??
                (staged
                  ? `Kopiert das Original nach ${work.directory}, wandelt dort um und kopiert das Ergebnis zurück. Der Speicher wird nur beim Kopieren belastet.`
                  : 'Liest und schreibt während der ganzen Umwandlung dort, wo die Datei liegt.')
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
                    ? `Startet ${describeSchedule(schedule)} – auch nach einem Neustart des Servers.`
                    : 'Startet gleich (oder nach der laufenden Umwandlung) und läuft auch weiter, wenn jemand streamt.'
              }
            />
          )}
        </div>
      )}

      <div className="space-y-1.5 rounded-lg bg-card-2 p-3 text-xs">
        <p>
          <span className="text-ink-2">Ziel: </span>
          <span className="font-mono break-all">{target}</span>
        </p>
        <p className="flex items-center gap-1.5 text-ink-2">
          <HardDrive className="size-3.5 shrink-0" aria-hidden />
          <span>
            {!targetNeeds
              ? 'Platzbedarf unbekannt'
              : staged
                ? `Am Ziel etwa ${formatBytes(targetNeeds)} für das Ergebnis`
                : `Braucht während der Umwandlung etwa ${formatBytes(targetNeeds)}`}
            {free !== null && ` · frei: ${formatBytes(free)}`}
          </span>
        </p>
        {staged && work.requiredBytes !== null && (
          <p className="flex items-center gap-1.5 text-ink-2">
            <HardDrive className="size-3.5 shrink-0" aria-hidden />
            <span>
              Im Arbeitsordner etwa {formatBytes(work.requiredBytes)} während der Umwandlung
              {work.freeBytes !== null && ` · frei: ${formatBytes(work.freeBytes)}`}
            </span>
          </p>
        )}
      </div>
      {tooLittleSpace && <Note tone="critical">Auf dem Ziellaufwerk ist zu wenig Platz frei.</Note>}
      {tooLittleWorkSpace && <Note tone="critical">Im Arbeitsordner ist zu wenig Platz frei.</Note>}
      {nameInvalid && <Note tone="critical">Der Dateiname muss auf .mkv enden und darf keine der Zeichen {'<>:"/\\|?*'} enthalten.</Note>}
      <p className="text-xs text-ink-3">
        Bei Profil 7 mit «FEL» (zusätzliche Bildinformation) geht diese Zusatzinformation verloren; bei «MEL» nichts. Behalte das
        Original, bis du das Ergebnis geprüft hast.
      </p>
      {error && <Note tone="critical">{error}</Note>}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className={secondaryButton}>
          Abbrechen
        </button>
        <button type="submit" disabled={pending || tooLittleSpace || tooLittleWorkSpace || nameInvalid} className={primaryButton}>
          {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
          {scheduled && hasSchedule ? 'Umwandlung einplanen' : 'Umwandlung starten'}
        </button>
      </div>
    </form>
  );
}

/** A choice as a dropdown, with what the chosen option does below it and its own fields. */
export function Choice<T extends string>(props: {
  id: string;
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={props.id} className="mb-1.5 block text-sm font-medium">
        {props.label}
      </label>
      <select id={props.id} value={props.value} onChange={(event) => props.onChange(event.target.value as T)} className={fieldClass}>
        {props.options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="mt-1.5 text-xs text-ink-2">{props.description}</p>
      {props.children && <div className="mt-3 space-y-2 rounded-xl p-3 ring-1 ring-line">{props.children}</div>}
    </div>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block text-ink-2">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false} className={fieldClass} />
    </label>
  );
}

function Note({ tone, children }: { tone: 'good' | 'critical'; children: ReactNode }) {
  const Icon = tone === 'good' ? CircleCheck : TriangleAlert;
  return (
    <div role={tone === 'critical' ? 'alert' : 'status'} className={clsx('flex gap-3 rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset', tone === 'good' ? 'bg-good/10 ring-good/25' : 'bg-critical/10 ring-critical/25')}>
      <Icon className={clsx('mt-0.5 size-4 shrink-0', tone === 'good' ? 'text-good' : 'text-critical')} aria-hidden />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

const fieldClass =
  'block w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-3 focus:ring-accent/20';
const primaryButton =
  'bg-brand inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60';
const secondaryButton = 'inline-flex items-center gap-1.5 rounded-lg bg-card px-3.5 py-2 text-sm font-medium text-ink ring-1 ring-line transition hover:bg-card-2';
