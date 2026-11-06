import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { DiscActivity, DiscDrive, DiscInfo, DiscRead, DiscRip, DiscSettings, DiscsStatus, DiscTitle } from '@manelly/shared';
import { CircleCheck, CircleX, Disc3, Eject, HardDriveDownload, Library, LoaderCircle, RefreshCw, ScanSearch, Settings2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Code, Message } from '../components/ConnectionForm';
import { Tabs, useTab, type TabEntry } from '../components/Tabs';
import { fetchJson } from '../lib/api';
import {
  useAgent,
  useAgentSettings,
  useCancelDiscRead,
  useCancelDiscRip,
  useDiscs,
  useEjectDisc,
  useLibraryMatches,
  useReadDisc,
  useRipDisc,
  useSetDiscSettings,
} from '../hooks/queries';
import { useNow } from '../hooks/useNow';
import { fileNamesFor, formatDuration, isPlainName, languageName, librarySearchFor, namesFromDisc, suggestSelection, type DiscKind } from '../lib/discs';
import { formatAgo, formatBitrate, formatBytes, joinParts } from '../lib/format';

const button =
  'inline-flex items-center gap-1.5 rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-ink ring-1 ring-line transition hover:bg-card-2 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButton =
  'bg-brand inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50';
const fieldClass =
  'block w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-3 focus:ring-accent/20';

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-line bg-card p-4 text-sm shadow-sm shadow-black/5 sm:p-5">{children}</div>;
}

type Tab = 'drives' | 'rips' | 'settings';
const TABS: Array<TabEntry<Tab>> = [
  { id: 'drives', label: 'Laufwerk', icon: Disc3 },
  { id: 'rips', label: 'Rips', icon: HardDriveDownload },
  { id: 'settings', label: 'Einstellungen', icon: Settings2 },
];

/** DVDs from the drive of the Jellyfin server into MKV files, with MakeMKV on the agent. */
export function DiscsPage() {
  useEffect(() => {
    document.title = 'Discs · Server · Manelly';
  }, []);
  const [tab, selectTab] = useTab(TABS);
  const agentSettings = useAgentSettings();
  const agent = useAgent({ enabled: Boolean(agentSettings.data?.url) });
  const status = agent.data?.status;
  const supported = Boolean(status?.discs);
  const discs = useDiscs(supported);

  let content: ReactNode;
  if (agentSettings.data && !agentSettings.data.url) {
    content = (
      <Card>
        Discs liest der Agent auf dem Jellyfin-Server. Zuerst den Agent unter{' '}
        <Link to="/server/agent" className="font-medium text-accent hover:underline">
          Server → Agent
        </Link>{' '}
        verbinden.
      </Card>
    );
  } else if (agent.data?.error) {
    content = <Message tone="critical">{agent.data.error}</Message>;
  } else if (!status) {
    content = <div aria-busy className="h-48 animate-pulse rounded-2xl bg-card-2" />;
  } else if (!supported) {
    content = (
      <Message tone="critical">
        Der Agent auf {status.hostname} ist zu alt für Discs (Version {status.version}, nötig ist 0.33.0) – unter Einstellungen → Updates «Alles
        aktualisieren».
      </Message>
    );
  } else if (discs.error) {
    content = <Message tone="critical">{discs.error.message}</Message>;
  } else if (!discs.data) {
    content = <div aria-busy className="h-48 animate-pulse rounded-2xl bg-card-2" />;
  } else if (!discs.data.tool) {
    content = <Setup hostname={status.hostname} />;
  } else {
    const { drives, reads, rips, settings, target, error } = discs.data;
    const active = (rip: DiscRip) => rip.state === 'queued' || rip.state === 'running';
    const counts: Record<Tab, number | null> = { drives: null, rips: rips.filter(active).length, settings: null };
    const tabs = TABS.map((entry) => ({ ...entry, label: entry.id === 'drives' && drives.length > 1 ? 'Laufwerke' : entry.label, count: counts[entry.id] }));
    content = (
      <div className="space-y-4">
        {!target && (
          <Message tone="critical">
            Die MKV-Dateien kommen in den Entpack-Ordner – den zuerst unter{' '}
            <Link to="/server/jdownloader?settings" className="font-medium underline">
              Server → JDownloader → Zahnrad
            </Link>{' '}
            festlegen.
          </Message>
        )}
        {error && <Message tone="critical">{error}</Message>}
        <div>
          <Tabs label="Discs" tabs={tabs} tab={tab} onSelect={selectTab}>
            {tab === 'drives' ? (
              <div className="space-y-4">
                {drives.length === 0 && !error && <Card>MakeMKV findet auf {status.hostname} kein Laufwerk.</Card>}
                {drives.map((drive) => (
                  <DriveCard
                    key={drive.index}
                    drive={drive}
                    read={reads.find((entry) => entry.drive === drive.index) ?? null}
                    ripping={rips.some((rip) => rip.drive === drive.index && active(rip))}
                    ejectByDefault={settings.eject}
                    canRip={Boolean(target)}
                    onShowRips={() => selectTab('rips')}
                  />
                ))}
              </div>
            ) : tab === 'rips' ? (
              rips.length > 0 ? (
                <Rips rips={rips} />
              ) : (
                <Card>
                  <p className="text-ink-2">Noch nichts gerippt. Im Tab «Laufwerk» die Disc lesen und die Titel wählen.</p>
                </Card>
              )
            ) : (
              <AutoSettings settings={settings} />
            )}
          </Tabs>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-accent">Server</p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Discs</h1>
          </div>
          {discs.data?.tool && <RefreshDrives />}
        </div>
        <p className="mt-1 text-sm text-ink-2">
          DVDs aus dem Laufwerk des Jellyfin-Servers ohne Qualitätsverlust in MKV-Dateien überführen – mit allen Ton- und Untertitelspuren und Kapiteln.
          Die Dateien landen im Entpack-Ordner und erscheinen unter{' '}
          <Link to="/server/extracted" className="font-medium text-accent hover:underline">
            Server → Extracted
          </Link>
          , von wo sie in die Mediathek kommen.
        </p>
      </header>
      {content}
    </div>
  );
}

/** Asks the drives again right away, e.g. after a new disc went in; otherwise the page looks every few seconds. */
function RefreshDrives() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      queryClient.setQueryData(['discs'], await fetchJson<DiscsStatus>('/api/agent/discs?refresh=1'));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={() => void refresh()} disabled={busy} className={button} title="Laufwerk neu abfragen, z. B. nach dem Einlegen einer Disc">
        <RefreshCw className={clsx('size-4', busy && 'animate-spin')} aria-hidden /> Aktualisieren
      </button>
      {error && <p className="max-w-64 text-right text-xs text-critical">{error}</p>}
    </div>
  );
}

/** MakeMKV is missing: how to install it, and looking for it again. */
function Setup({ hostname }: { hostname: string }) {
  const queryClient = useQueryClient();
  const [looking, setLooking] = useState(false);
  async function lookAgain() {
    setLooking(true);
    try {
      // The agent looks for its tools again.
      await fetchJson('/api/agent?refresh=1');
      await queryClient.invalidateQueries({ queryKey: ['discs'] });
      await queryClient.invalidateQueries({ queryKey: ['agent'] });
    } finally {
      setLooking(false);
    }
  }
  return (
    <Card>
      <p className="font-medium">MakeMKV fehlt auf {hostname}</p>
      <p className="mt-1 text-ink-2">Manelly lässt MakeMKV die Discs lesen. Einmal auf dem Jellyfin-Server einrichten:</p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-ink-2">
        <li>
          MakeMKV für Windows von{' '}
          <a href="https://www.makemkv.com/download/" target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">
            makemkv.com
          </a>{' '}
          herunterladen und installieren. Für DVDs ist es gratis, auch nach der Testzeit.
        </li>
        <li>MakeMKV einmal starten und die Lizenzbedingungen bestätigen; danach kann es wieder zu.</li>
        <li>
          Der Agent findet <Code>makemkvcon64.exe</Code> von selbst unter <Code>C:\Program Files (x86)\MakeMKV</Code>. Liegt es anderswo: Pfad in{' '}
          <Code>agent.json</Code> unter <Code>tools.makemkv</Code> eintragen.
        </li>
      </ol>
      <button type="button" onClick={() => void lookAgain()} disabled={looking} className={clsx(button, 'mt-4')}>
        <RefreshCw className={clsx('size-4', looking && 'animate-spin')} aria-hidden /> Erneut suchen
      </button>
    </Card>
  );
}

const STATES: Record<DiscDrive['state'], string> = { empty: 'Leer', open: 'Lade offen', loading: 'Disc wird geladen …', inserted: '' };
const KINDS: Record<string, string> = { dvd: 'DVD', bluray: 'Blu-ray' };

function DriveCard({
  drive,
  read,
  ripping,
  ejectByDefault,
  canRip,
  onShowRips,
}: {
  drive: DiscDrive;
  read: DiscRead | null;
  ripping: boolean;
  ejectByDefault: boolean;
  canRip: boolean;
  onShowRips: () => void;
}) {
  const readDisc = useReadDisc();
  const eject = useEjectDisc();
  const inserted = drive.state === 'inserted';
  const info = read?.state === 'done' && inserted ? read.info : null;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/12 text-accent">
            <Disc3 className={clsx('size-5', (drive.busy || drive.state === 'loading') && 'animate-spin [animation-duration:3s]')} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-medium break-words">{inserted ? (drive.disc ?? 'Disc ohne Namen') : STATES[drive.state]}</p>
            <p className="text-xs text-ink-2">{joinParts([inserted && (drive.kind ? KINDS[drive.kind] : 'Disc'), drive.name, drive.device])}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => readDisc.mutate(drive.index)}
            disabled={!inserted || drive.busy || readDisc.isPending}
            className={button}
            title="Die Titel der Disc mit MakeMKV lesen"
          >
            <ScanSearch className="size-4" aria-hidden /> {info ? 'Neu lesen' : 'Disc lesen'}
          </button>
          <button type="button" onClick={() => eject.mutate(drive.index)} disabled={drive.busy || eject.isPending || drive.state === 'empty'} className={button}>
            {eject.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Eject className="size-4" aria-hidden />} Auswerfen
          </button>
        </div>
      </div>
      {readDisc.isError && <p className="mt-3 text-critical">{readDisc.error.message}</p>}
      {eject.isError && <p className="mt-3 text-critical">{eject.error.message}</p>}
      {read?.state === 'reading' && <Reading read={read} />}
      {(read?.state === 'failed' || read?.state === 'canceled') && (
        <div className="mt-3">
          <p className={read.state === 'failed' ? 'text-critical' : 'text-ink-2'}>{read.state === 'canceled' ? 'Lesen abgebrochen.' : read.error}</p>
          <Messages activity={read} />
        </div>
      )}
      {ripping && (
        <p className="mt-3 text-ink-2">
          Von dieser Disc wird gerade gerippt – den Fortschritt zeigt der Tab{' '}
          <button type="button" onClick={onShowRips} className="font-medium text-accent hover:underline">
            «Rips»
          </button>
          .
        </p>
      )}
      {info && !ripping && <RipForm key={info.readAt} info={info} ejectByDefault={ejectByDefault} canRip={canRip} onStarted={onShowRips} />}
    </Card>
  );
}

/** "2:05" since `since`; hours as "1:02:05". */
function elapsed(since: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(since)) / 1000));
  return formatDuration(seconds);
}

/** While MakeMKV reads: its step, how far, for how long – and a way out for a disc it does not get through. */
function Reading({ read }: { read: DiscRead }) {
  const cancel = useCancelDiscRead();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  // Agents before 0.34.0 tell neither the step nor take a cancel.
  const detailed = read.messages !== undefined;
  const slow = read.startedAt !== undefined && now - Date.parse(read.startedAt) > 3 * 60_000;
  return (
    <div className="mt-3 rounded-xl bg-card-2/50 p-3 ring-1 ring-line" role="status">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="flex min-w-0 items-start gap-2 text-ink-2">
          <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-accent" aria-hidden />
          <span className="min-w-0">
            <span className="text-ink">{read.auto ? 'Disc eingelegt – MakeMKV liest sie' : 'MakeMKV liest die Disc'}</span>
            {read.startedAt && <span className="tabular-nums"> · seit {elapsed(read.startedAt, now)}</span>}
            <span className="block text-xs">
              {joinParts([
                read.step ?? (detailed ? 'Startet …' : 'Bei einer DVD meist bis etwa eine Minute'),
                read.stepProgress != null && `${Math.round(read.stepProgress * 100)} %`,
              ])}
            </span>
          </span>
        </p>
        {detailed && (
          <button type="button" onClick={() => cancel.mutate(read.drive)} disabled={cancel.isPending} className={button}>
            Abbrechen
          </button>
        )}
      </div>
      {read.stepProgress != null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-accent/15">
          <div className="bg-brand h-full rounded-full transition-[width]" style={{ width: `${Math.max(read.stepProgress * 100, 1)}%` }} />
        </div>
      )}
      {slow && (
        <p className="mt-2 text-xs text-ink-2">
          Das dauert ungewöhnlich lange. Oft ist die Disc zerkratzt oder hat einen Kopierschutz mit vielen Schein-Titeln – die Meldungen unten zeigen
          Lesefehler. Nach 30 Minuten gibt der Agent auf.
        </p>
      )}
      <Messages activity={read} />
      {cancel.isError && <p className="mt-2 text-xs text-critical">{cancel.error.message}</p>}
    </div>
  );
}

/** What MakeMKV reported, folded away; errors count and show in red. */
function Messages({ activity }: { activity: DiscActivity }) {
  const messages = activity.messages ?? [];
  if (messages.length === 0) return null;
  const errors = messages.filter((message) => message.error).length;
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-ink-2 select-none hover:text-ink">
        Meldungen von MakeMKV ({messages.length}
        {errors > 0 && <span className="text-critical">, davon {errors} Fehler</span>})
      </summary>
      <ol className="mt-1.5 max-h-64 space-y-0.5 overflow-y-auto rounded-lg bg-card p-2 font-mono text-[0.6875rem] ring-1 ring-line">
        {messages.map((message, at) => (
          <li key={at} className={clsx('break-words', message.error ? 'text-critical' : 'text-ink-2')}>
            <span className="text-ink-3">{new Date(message.at).toLocaleTimeString('de-CH')}</span> {message.text}
          </li>
        ))}
      </ol>
    </details>
  );
}

const two = (value: number) => String(value).padStart(2, '0');

/** Which titles to rip, and under which names. */
function RipForm({ info, ejectByDefault, canRip, onStarted }: { info: DiscInfo; ejectByDefault: boolean; canRip: boolean; onStarted: () => void }) {
  const id = useId();
  const rip = useRipDisc();
  const [suggested] = useState(() => suggestSelection(info.titles));
  const [names] = useState(() => namesFromDisc(info.name));
  const [kind, setKind] = useState<DiscKind>(suggested.kind);
  const [selected, setSelected] = useState<Set<number>>(new Set(suggested.selected));
  const [name, setName] = useState(suggested.kind === 'serie' ? names.series : names.film);
  const [season, setSeason] = useState(names.season ?? 1);
  const [firstEpisode, setFirstEpisode] = useState(1);
  const [custom, setCustom] = useState<Map<number, string>>(new Map());
  const [eject, setEject] = useState(ejectByDefault);

  const derived = fileNamesFor(kind, name, [...selected], season, firstEpisode);
  const fileName = (index: number) => custom.get(index) ?? derived.get(index) ?? '';
  const folder = kind === 'serie' ? `${name.trim()} S${two(season)}` : name.trim();
  const chosen = info.titles.filter((title) => selected.has(title.index));
  const bytes = chosen.reduce((sum, title) => sum + (title.bytes ?? 0), 0);
  const files = chosen.map((title) => fileName(title.index));
  const problem = !name.trim()
    ? 'Einen Namen eingeben.'
    : !isPlainName(folder)
      ? `«${folder}» geht nicht als Ordnername – ohne < > : " / \\ | ? * und nicht mit Punkt oder Leerzeichen am Ende.`
      : chosen.length === 0
        ? 'Mindestens einen Titel wählen.'
        : files.find((entry) => !isPlainName(entry) || !/\.mkv$/i.test(entry))
          ? `«${files.find((entry) => !isPlainName(entry) || !/\.mkv$/i.test(entry))}» geht nicht als Dateiname; er muss auf .mkv enden.`
          : new Set(files.map((entry) => entry.toLowerCase())).size < files.length
            ? 'Zwei Titel haben denselben Dateinamen.'
            : null;

  function toggle(index: number) {
    const next = new Set(selected);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setSelected(next);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (problem) return;
    // The progress shows in the tab «Rips».
    rip.mutate({ drive: info.drive, folder, titles: chosen.map((title) => ({ index: title.index, fileName: fileName(title.index) })), eject }, { onSuccess: onStarted });
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <span className="mb-1 block text-xs font-medium text-ink-2">Art</span>
          <div className="inline-flex rounded-lg p-0.5 ring-1 ring-line" role="radiogroup" aria-label="Art">
            {(['film', 'serie'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={kind === option}
                onClick={() => setKind(option)}
                className={clsx('rounded-md px-3 py-1 text-sm font-medium', kind === option ? 'bg-accent/12 text-accent' : 'text-ink-2 hover:text-ink')}
              >
                {option === 'film' ? 'Film' : 'Serie'}
              </button>
            ))}
          </div>
        </div>
        <label htmlFor={`${id}-name`} className="min-w-48 flex-1">
          <span className="mb-1 block text-xs font-medium text-ink-2">{kind === 'film' ? 'Film (mit Jahr, z. B. «Findet Nemo (2003)»)' : 'Serie'}</span>
          <input id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} />
        </label>
        {kind === 'serie' && (
          <>
            <label htmlFor={`${id}-season`} className="w-24">
              <span className="mb-1 block text-xs font-medium text-ink-2">Staffel</span>
              <input id={`${id}-season`} type="number" min={0} max={99} value={season} onChange={(event) => setSeason(Math.max(0, Number(event.target.value) || 0))} className={fieldClass} />
            </label>
            <label htmlFor={`${id}-episode`} className="w-28">
              <span className="mb-1 block text-xs font-medium text-ink-2">Erste Folge</span>
              <input id={`${id}-episode`} type="number" min={1} max={999} value={firstEpisode} onChange={(event) => setFirstEpisode(Math.max(1, Number(event.target.value) || 1))} className={fieldClass} />
            </label>
          </>
        )}
      </div>
      <LibraryCheck name={name} kind={kind} />

      <div className="overflow-x-auto rounded-xl ring-1 ring-line">
        <table className="w-full text-left text-xs">
          <thead className="bg-card-2/60 text-ink-2">
            <tr>
              <th className="w-8 px-3 py-2" />
              <th className="px-2 py-2 font-medium">Titel</th>
              <th className="px-2 py-2 font-medium">Länge</th>
              <th className="px-2 py-2 font-medium">Grösse</th>
              <th className="px-2 py-2 font-medium">Ton · Untertitel</th>
              <th className="px-2 py-2 font-medium">Datei</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {info.titles.map((title) => (
              <TitleRow
                key={title.index}
                title={title}
                checked={selected.has(title.index)}
                suggested={suggested.selected.includes(title.index) ? (suggested.kind === 'film' ? 'Hauptfilm' : 'Folge') : null}
                fileName={fileName(title.index)}
                onToggle={() => toggle(title.index)}
                onRename={(value) => setCustom(new Map(custom).set(title.index, value))}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-2">
          {joinParts([
            `${chosen.length} Titel`,
            bytes > 0 && `etwa ${formatBytes(bytes)}`,
            folder && `in den Ordner «${folder}» im Entpack-Ordner`,
          ])}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={eject} onChange={(event) => setEject(event.target.checked)} className="size-4 accent-accent" /> Danach auswerfen
          </label>
          <button type="submit" disabled={Boolean(problem) || rip.isPending || !canRip} className={primaryButton}>
            {rip.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Disc3 className="size-4" aria-hidden />} Rippen
          </button>
        </div>
      </div>
      {problem && chosen.length > 0 && <p className="text-xs text-critical">{problem}</p>}
      {rip.isError && <Message tone="critical">{rip.error.message}</Message>}
    </form>
  );
}

function TitleRow({
  title,
  checked,
  suggested,
  fileName,
  onToggle,
  onRename,
}: {
  title: DiscTitle;
  checked: boolean;
  suggested: string | null;
  fileName: string;
  onToggle: () => void;
  onRename: (value: string) => void;
}) {
  const audio = title.audio.map((track) => [languageName(track.language, track.languageName), track.codec, track.channels].filter(Boolean).join(' ')).join(', ');
  const subtitles = title.subtitles.map((track) => languageName(track.language, track.languageName)).join(', ');
  return (
    <tr className={clsx(checked && 'bg-accent/5')}>
      <td className="px-3 py-2 align-top">
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Titel ${title.index + 1} rippen`} className="mt-0.5 size-4 accent-accent" />
      </td>
      <td className="px-2 py-2 align-top whitespace-nowrap">
        <span className="font-medium text-ink">Titel {title.index + 1}</span>
        {suggested && <span className="ml-1.5 rounded bg-accent/12 px-1.5 py-px text-[0.6875rem] font-semibold text-accent">{suggested}</span>}
        <span className="block text-ink-3">
          {joinParts([title.chapters > 0 && `${title.chapters} Kapitel`, title.video && [title.video.size, title.video.aspect].filter(Boolean).join(' ')])}
        </span>
      </td>
      <td className="px-2 py-2 align-top tabular-nums">{formatDuration(title.durationSeconds)}</td>
      <td className="px-2 py-2 align-top whitespace-nowrap tabular-nums">{title.bytes ? formatBytes(title.bytes) : '–'}</td>
      <td className="px-2 py-2 align-top text-ink-2">
        {audio || 'kein Ton'}
        {subtitles && <span className="block text-ink-3">UT: {subtitles}</span>}
      </td>
      <td className="min-w-56 px-2 py-2 align-top">
        {checked ? (
          <input value={fileName} onChange={(event) => onRename(event.target.value)} aria-label={`Dateiname von Titel ${title.index + 1}`} spellCheck={false} className={clsx(fieldClass, 'py-1 font-mono text-xs')} />
        ) : (
          <span className="text-ink-3">–</span>
        )}
      </td>
    </tr>
  );
}

/** Whether the film or series is in the library already, by its name. */
function LibraryCheck({ name, kind }: { name: string; kind: DiscKind }) {
  const q = librarySearchFor(name);
  const matches = useLibraryMatches(q, kind === 'film' ? 'Movie' : 'Series');
  if (q.length < 2) return null;
  if (matches.isPending) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-ink-2">
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> Schaue in der Mediathek nach …
      </p>
    );
  }
  if (matches.isError) return <p className="text-xs text-ink-3">In der Mediathek liess sich nicht nachschauen: {matches.error.message}</p>;
  const items = matches.data.items;
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-ink-2">
        <Library className="size-3.5" aria-hidden /> «{q}» ist noch nicht in der Mediathek{matches.data.index.state === 'building' ? ' (der Index wird gerade aufgebaut)' : ''}.
      </p>
    );
  }
  return (
    <div className="rounded-lg bg-warning/10 px-3 py-2 text-xs ring-1 ring-warning/25 ring-inset" role="status">
      <p className="font-medium text-ink">{kind === 'film' ? 'Schon in der Mediathek:' : 'Die Serie gibt es in der Mediathek schon:'}</p>
      <ul className="mt-1 space-y-0.5">
        {items.map((item) => (
          <li key={item.id}>
            <Link to={`/media?item=${encodeURIComponent(item.id)}`} className="font-medium text-accent hover:underline">
              {item.name}
              {item.year && ` (${item.year})`}
            </Link>
            <span className="text-ink-2">
              {' '}
              · {joinParts([item.resolutions.join(', '), item.episodes && `${item.episodes.total} ${item.episodes.total === 1 ? 'Folge' : 'Folgen'}`])}
            </span>
          </li>
        ))}
      </ul>
      {kind === 'serie' && <p className="mt-1 text-ink-2">Ob diese Folgen schon dabei sind, zeigt die Serie in Medien.</p>}
    </div>
  );
}

/** What is left to write of a rip; null when MakeMKV did not say how big a title is. */
function remainingBytes(rip: DiscRip): number | null {
  const open = rip.titles.filter((title) => title.state !== 'done');
  if (open.some((title) => title.bytes === null)) return null;
  const done = rip.titles.length - open.length;
  const current = rip.titles.find((title) => title.state === 'running');
  const share = Math.max(0, rip.progress * rip.titles.length - done);
  return open.reduce((sum, title) => sum + (title.bytes ?? 0), 0) - (current?.bytes ?? 0) * share;
}

/** Rips under way and the last ones done. */
function Rips({ rips }: { rips: DiscRip[] }) {
  const now = useNow(30_000);
  const cancel = useCancelDiscRip();
  return (
    <Card>
      <ul className="-my-3 divide-y divide-line">
        {rips.slice(0, 8).map((rip) => {
          const active = rip.state === 'queued' || rip.state === 'running';
          const done = rip.titles.filter((title) => title.state === 'done').length;
          const current = rip.titles.findIndex((title) => title.state === 'running');
          const left = remainingBytes(rip);
          const eta = rip.bytesPerSecond && left ? Math.max(1, Math.round(left / rip.bytesPerSecond / 60)) : null;
          return (
            <li key={rip.id} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="flex min-w-0 items-start gap-2">
                  {active ? (
                    <LoaderCircle className={clsx('mt-0.5 size-4 shrink-0 text-accent', rip.state === 'running' && 'animate-spin')} aria-hidden />
                  ) : rip.state === 'done' ? (
                    <CircleCheck className="mt-0.5 size-4 shrink-0 text-good" aria-hidden />
                  ) : (
                    <CircleX className={clsx('mt-0.5 size-4 shrink-0', rip.state === 'canceled' ? 'text-ink-3' : 'text-critical')} aria-hidden />
                  )}
                  <span className="min-w-0">
                    <span className="font-medium break-words">{rip.folder}</span>
                    <span className="block text-xs text-ink-2">
                      {joinParts([
                        `von «${rip.disc}»`,
                        rip.state === 'queued' && 'wartet',
                        rip.state === 'running' && current >= 0 && `Titel ${current + 1} von ${rip.titles.length}`,
                        rip.state === 'done' && `${done} Titel fertig`,
                        rip.state === 'canceled' && 'abgebrochen',
                        rip.auto && 'automatisch',
                        rip.finishedAt && formatAgo(Date.parse(rip.finishedAt), now),
                      ])}
                    </span>
                  </span>
                </p>
                {active ? (
                  <button type="button" onClick={() => cancel.mutate(rip.id)} disabled={cancel.isPending} className={button}>
                    Abbrechen
                  </button>
                ) : (
                  rip.state === 'done' && (
                    <Link to="/server/extracted" className="text-xs font-medium text-accent hover:underline">
                      Unter Extracted
                    </Link>
                  )
                )}
              </div>
              {rip.state === 'running' && (
                <>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-accent/15">
                    <div className="bg-brand h-full rounded-full transition-[width]" style={{ width: `${Math.max(rip.progress * 100, 1)}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-ink-2 tabular-nums">
                    {joinParts([
                      `${Math.round(rip.progress * 100)} %`,
                      rip.bytesPerSecond !== null && formatBitrate(rip.bytesPerSecond * 8),
                      eta !== null && `noch etwa ${eta} min`,
                      rip.step,
                    ])}
                  </p>
                </>
              )}
              {rip.error && <p className={clsx('mt-1 text-xs', rip.state === 'done' ? 'text-ink-2' : 'text-critical')}>{rip.error}</p>}
              <Messages activity={rip} />
            </li>
          );
        })}
      </ul>
      {cancel.isError && <p className="mt-2 text-xs text-critical">{cancel.error.message}</p>}
    </Card>
  );
}

function AutoSettings({ settings }: { settings: DiscSettings }) {
  const save = useSetDiscSettings();
  const { auto, eject, read } = settings;
  // Agents before 0.35.0 do not know `read`; they get only what they know.
  const change = (next: Partial<DiscSettings>) => save.mutate(read === undefined ? { auto, eject, ...next } : { auto, eject, read, ...next });
  return (
    <Card>
      {read !== undefined && (
        <label className="mb-3 flex items-start gap-2.5">
          <input type="checkbox" checked={read} disabled={save.isPending} onChange={(event) => change({ read: event.target.checked })} className="mt-0.5 size-4 accent-accent" />
          <span>
            <span className="font-medium">Eingelegte Disc automatisch lesen</span>
            <span className="block text-ink-2">
              Sobald eine Disc im Laufwerk liegt, liest der Agent ihre Titel – auch ohne dass Manelly offen ist. Gerippt wird nichts; die Titel stehen
              bereit, wenn du die Seite öffnest. Dafür fragt der Agent das Laufwerk alle 15 Sekunden ab.
            </span>
          </span>
        </label>
      )}
      <label className="flex items-start gap-2.5">
        <input type="checkbox" checked={auto} disabled={save.isPending} onChange={(event) => change({ auto: event.target.checked })} className="mt-0.5 size-4 accent-accent" />
        <span>
          <span className="font-medium">Automatisch rippen</span>
          <span className="block text-ink-2">
            Eine eingelegte DVD liest der Agent selbst, rippt den Hauptfilm in einen Ordner mit dem Namen der Disc und wirft sie aus – auch ohne dass
            Manelly offen ist. Disc nach Disc einlegen genügt. Serien-DVDs besser von Hand, mit Staffel und Folgen.
          </span>
        </span>
      </label>
      <label className="mt-3 flex items-start gap-2.5">
        <input type="checkbox" checked={eject} disabled={save.isPending} onChange={(event) => change({ eject: event.target.checked })} className="mt-0.5 size-4 accent-accent" />
        <span>
          <span className="font-medium">Nach dem Rippen auswerfen</span>
          <span className="block text-ink-2">Vorgabe für «Danach auswerfen»; im automatischen Modus wirft der Agent immer aus.</span>
        </span>
      </label>
      {read === undefined && (
        <p className="mt-3 text-xs text-ink-3">Eingelegte Discs automatisch lesen geht ab Agent 0.35.0 – unter Einstellungen → Updates «Alles aktualisieren».</p>
      )}
      {save.isError && <p className="mt-2 text-xs text-critical">{save.error.message}</p>}
    </Card>
  );
}
