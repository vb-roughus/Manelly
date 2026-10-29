import { createContext, useContext, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { JDownloaderExtraction, JDownloaderLink, JDownloaderPackage, JDownloaderStatus } from '@manelly/shared';
import { ChevronDown, CircleCheck, CircleX, Download, Gauge, LoaderCircle, Pause, Play, Square, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { useAgent, useAgentSettings, useControlJDownloader, useJDownloader, useJDownloaderLimit, useRemoveDownloads } from '../hooks/queries';
import { usePersistentFlag } from '../hooks/usePersistentFlag';
import { formatBitrate, formatBytes, formatEta, mbitField, mbitToKib } from '../lib/format';
import {
  allState,
  clickLink,
  clickPackage,
  describeSelection,
  groupState,
  isEmpty,
  linkSelected,
  NOTHING_SELECTED,
  packageState,
  pruneSelection,
  selectedLinks,
  selectionRequest,
  toggleAll,
  toggleGroup,
  type PackageSelection,
  type SelectionAnchor,
} from '../lib/packageSelection';
import { Message } from './ConnectionForm';
import { Modal } from './Modal';
import { keepTextOnShift, Tick } from './Tick';

const MAX_SHOWN = 6;

const STATES: Record<string, string> = { RUNNING: 'lädt', PAUSE: 'pausiert', IDLE: 'bereit', STOPPING: 'hält an', STOPPED: 'gestoppt' };

/** Ticking packages and their parts, to delete them; only on the JDownloader page. */
interface Picker {
  selection: PackageSelection;
  /** A click on a box; with shift, for a range. `shown` are the parts in the order shown. */
  pickPackage: (pkg: JDownloaderPackage, shift: boolean) => void;
  pickLink: (pkg: JDownloaderPackage, shown: number[], uuid: number, shift: boolean) => void;
  pickGroup: (packages: JDownloaderPackage[]) => void;
}

const PickerContext = createContext<Picker | null>(null);

/** Still worth a look: downloading, unpacking after the download, or unpacking failed. */
export function isActivePackage(pkg: JDownloaderPackage): boolean {
  return !pkg.finished || pkg.extraction?.state === 'running' || pkg.extraction?.state === 'failed';
}

/** "lädt · 96 Mbit/s · gebremst", or why JDownloader does not answer. */
export function downloadsSummary(status: JDownloaderStatus): string {
  if (!status.reachable) return 'nicht erreichbar';
  const state = status.state ? (STATES[status.state] ?? status.state.toLowerCase()) : null;
  // JDownloader calls itself idle while it unpacks.
  const unpacking = status.packages.filter((pkg) => pkg.extraction?.state === 'running').length;
  return [
    state,
    status.state === 'RUNNING' && status.speedBps ? formatBitrate(status.speedBps * 8) : null,
    unpacking ? (unpacking === 1 ? '1 Paket wird entpackt' : `${unpacking} Pakete werden entpackt`) : null,
    status.throttling.active ? 'gebremst' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** JDownloader on the Jellyfin server: state, speed, packages, controls; only when switched on in the settings. */
export function DashboardDownloads() {
  const agentSettings = useAgentSettings();
  const agent = useAgent({ enabled: Boolean(agentSettings.data?.url && agentSettings.data.hasToken) });
  const enabled = Boolean(agent.data?.status?.jdownloader?.enabled);
  const { data } = useJDownloader(enabled);
  const [open, setOpen] = useState(false);
  if (!enabled || !data) return null;

  const summary = downloadsSummary(data);

  return (
    <section aria-labelledby="downloads-heading">
      <div className={clsx('flex flex-wrap items-baseline justify-between gap-2', open && 'mb-3')}>
        <h2 id="downloads-heading" className="text-lg font-semibold">
          <button
            type="button"
            aria-expanded={open}
            aria-controls="downloads-content"
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Download className="size-4 text-accent" aria-hidden />
            Downloads
            <span className={clsx('text-sm font-normal', data.reachable ? 'text-ink-2' : 'text-critical')}>· {summary}</span>
            <ChevronDown className={clsx('size-4 text-ink-3 transition', !open && '-rotate-90')} aria-hidden />
          </button>
        </h2>
        <Link to="/server/jdownloader" className="text-sm font-medium text-accent hover:underline">
          Zu JDownloader
        </Link>
      </div>
      <div id="downloads-content" hidden={!open} className="rounded-2xl border border-line bg-card p-4 shadow-sm shadow-black/5">
        {data.reachable ? <Downloads status={data} /> : <p className="text-sm text-critical">{data.error}</p>}
      </div>
    </section>
  );
}

/**
 * Controls, speed limit and packages; the dashboard shows the first few, the JDownloader page all of them,
 * and there (`expandable`) every package opens to its parts and the finished ones to their rows. With `removable`
 * (the JDownloader page with an agent from 0.29.0) packages and parts can be ticked and deleted; false says why not.
 */
export function Downloads({
  status,
  maxShown = MAX_SHOWN,
  expandable = false,
  removable,
}: {
  status: JDownloaderStatus;
  maxShown?: number;
  expandable?: boolean;
  removable?: boolean;
}) {
  const active = status.packages.filter(isActivePackage);
  const finished = status.packages.filter((pkg) => !isActivePackage(pkg));
  const [ticked, setTicked] = useState<PackageSelection>(NOTHING_SELECTED);
  const [anchor, setAnchor] = useState<SelectionAnchor>(null);
  const [removing, setRemoving] = useState(false);
  // What JDownloader finished and removed itself meanwhile is no longer ticked.
  const selection = pruneSelection(ticked, status.packages);
  const shown = [...active.slice(0, maxShown), ...finished];
  const chosen = selectedLinks(selection, status.packages);
  const picker: Picker | null = removable
    ? {
        selection,
        pickPackage: (pkg, shift) => {
          setTicked(clickPackage(selection, shown, pkg, anchor, shift));
          setAnchor({ package: pkg.uuid, link: null });
        },
        pickLink: (pkg, parts, uuid, shift) => {
          setTicked(clickLink(selection, pkg, parts, uuid, anchor, shift));
          setAnchor({ package: pkg.uuid, link: uuid });
        },
        pickGroup: (group) => setTicked(toggleGroup(selection, group)),
      }
    : null;

  return (
    <PickerContext.Provider value={picker}>
      <div className="space-y-4">
        <Controls status={status} />
        {status.throttling.reason && (
          <p className="flex items-center gap-2 rounded-lg bg-card-2 px-3 py-2 text-sm">
            <Gauge className="size-4 shrink-0 text-accent" aria-hidden />
            {status.throttling.reason} Danach läuft JDownloader wieder wie vorher.
          </p>
        )}
        {picker && status.packages.length > 0 && (
          <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line pt-3 text-sm">
            <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-ink-2">
              <Tick state={allState(selection, status.packages)} label="Alle Pakete auswählen" onChange={() => setTicked(toggleAll(selection, status.packages))} />
              <span>{chosen > 0 ? `${chosen} ${chosen === 1 ? 'Datei' : 'Dateien'} ausgewählt` : 'Ankreuzen zum Löschen – mit Shift einen ganzen Bereich'}</span>
              {!isEmpty(selection) && (
                <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => setTicked(NOTHING_SELECTED)}>
                  Auswahl aufheben
                </button>
              )}
            </p>
            {!isEmpty(selection) && (
              <button type="button" className={button} onClick={() => setRemoving(true)}>
                <Trash2 className="size-4" aria-hidden /> Löschen
              </button>
            )}
          </div>
        )}
        {removable === false && status.packages.length > 0 && (
          <p className="text-xs text-ink-3">Löschen geht ab Agent 0.29.0 – unter Server → Agent «Aktualisieren & neu starten».</p>
        )}
        {status.packages.length === 0 ? (
          <p className="text-sm text-ink-2">Keine Downloads in der Liste.</p>
        ) : (
          <div className="space-y-4" onMouseDown={picker ? keepTextOnShift : undefined}>
            {active.length > 0 && (
              <ul className="space-y-3">
                {active.slice(0, maxShown).map((pkg) => (
                  <PackageRow key={pkg.uuid} pkg={pkg} expandable={expandable} />
                ))}
              </ul>
            )}
            {active.length > maxShown && <p className="text-xs text-ink-3">und {active.length - maxShown} weitere Pakete in der Warteschlange</p>}
            {finished.length > 0 && <FinishedPackages packages={finished} expandable={expandable} />}
          </div>
        )}
      </div>
      <Modal open={removing} onClose={() => setRemoving(false)} icon={Trash2} tone="critical" title="Aus den Downloads entfernen">
        {removing && (
          <RemoveDownloads
            selection={selection}
            packages={status.packages}
            onCancel={() => setRemoving(false)}
            onDone={() => {
              setRemoving(false);
              setTicked(NOTHING_SELECTED);
            }}
          />
        )}
      </Modal>
    </PickerContext.Provider>
  );
}

/** What leaves the download list, asked first – and whether its files go too. */
function RemoveDownloads({
  selection,
  packages,
  onCancel,
  onDone,
}: {
  selection: PackageSelection;
  packages: JDownloaderPackage[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const remove = useRemoveDownloads();
  const [deleteFiles, setDeleteFiles] = useState(false);
  const whole = packages.filter((pkg) => selection.packages.has(pkg.uuid));
  const parts = packages.flatMap((pkg) => (pkg.links ?? []).filter((link) => selection.links.has(link.uuid)));
  const names = [...whole.map((pkg) => pkg.name), ...parts.map((link) => link.name)];
  const inPackages = whole.reduce((sum, pkg) => sum + pkg.childCount, 0);
  const running = whole.some((pkg) => pkg.running) || parts.some((link) => link.running);
  const unpacking = whole.filter((pkg) => pkg.extraction?.state === 'running').map((pkg) => pkg.name);
  return (
    <div className="space-y-4 text-sm">
      <p>
        <span className="font-medium">{describeSelection(whole.length, inPackages, parts.length, { item: ['Datei', 'Dateien'], single: ['einzelne Datei', 'einzelne Dateien'] })}</span>
        {running && ' – was davon gerade lädt, bricht JDownloader ab.'}
      </p>
      <ul className="rounded-xl bg-card-2/50 p-3 text-xs text-ink-2 ring-1 ring-line">
        {names.slice(0, 6).map((name, index) => (
          <li key={`${index}-${name}`} className="truncate">
            {name}
          </li>
        ))}
        {names.length > 6 && <li>und {names.length - 6} weitere</li>}
      </ul>
      <label className={clsx('flex cursor-pointer items-start gap-2.5 rounded-xl p-3 ring-1 transition', deleteFiles ? 'bg-critical/8 ring-critical/40' : 'ring-line')}>
        <input type="checkbox" checked={deleteFiles} onChange={(event) => setDeleteFiles(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-critical" />
        <span>
          <span className="block font-medium">Auch die heruntergeladenen Dateien löschen</span>
          <span className="block text-xs text-ink-2">Archive und angefangene Teile auf der Platte. Was daraus schon entpackt wurde, bleibt.</span>
        </span>
      </label>
      {deleteFiles && unpacking.length > 0 && (
        <Message tone="critical">
          {unpacking.length === 1 ? `«${unpacking[0]}» wird` : `${unpacking.length} Pakete werden`} gerade entpackt – ohne die Archive bricht das Entpacken ab.
        </Message>
      )}
      {remove.isError && <Message tone="critical">{remove.error.message}</Message>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className={button}>
          Abbrechen
        </button>
        <button
          type="button"
          disabled={remove.isPending}
          onClick={() => remove.mutate({ ...selectionRequest(selection), deleteFiles }, { onSuccess: onDone })}
          className={dangerButton}
        >
          {remove.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
          {deleteFiles ? 'Entfernen und Dateien löschen' : 'Entfernen'}
        </button>
      </div>
    </div>
  );
}

const button =
  'inline-flex items-center gap-1.5 rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-ink ring-1 ring-line transition hover:bg-card-2 disabled:cursor-wait disabled:opacity-60';
const dangerButton =
  'inline-flex items-center gap-1.5 rounded-lg bg-critical px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60';

function Controls({ status }: { status: JDownloaderStatus }) {
  const control = useControlJDownloader();
  const running = status.state === 'RUNNING';
  const paused = status.state === 'PAUSE';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2">
        {running && (
          <button type="button" className={button} disabled={control.isPending} onClick={() => control.mutate('pause')}>
            <Pause className="size-4" aria-hidden /> Pausieren
          </button>
        )}
        {paused && (
          <button type="button" className={button} disabled={control.isPending} onClick={() => control.mutate('resume')}>
            <Play className="size-4" aria-hidden /> Fortsetzen
          </button>
        )}
        {!running && !paused && (
          <button type="button" className={button} disabled={control.isPending} onClick={() => control.mutate('start')}>
            <Play className="size-4" aria-hidden /> Starten
          </button>
        )}
        {(running || paused) && (
          <button type="button" className={button} disabled={control.isPending} onClick={() => control.mutate('stop')}>
            <Square className="size-4" aria-hidden /> Stoppen
          </button>
        )}
      </div>
      <SpeedLimit status={status} />
      {control.isError && <p className="w-full text-sm text-critical">{control.error.message}</p>}
    </div>
  );
}

/** JDownloader's own speed limit, changed by hand; the throttle while streaming puts this value back afterwards. */
function SpeedLimit({ status }: { status: JDownloaderStatus }) {
  const save = useJDownloaderLimit();
  const [editing, setEditing] = useState(false);
  const current = status.limit;
  const [enabled, setEnabled] = useState(current?.enabled ?? false);
  const [mbit, setMbit] = useState(current && current.bytesPerSecond > 0 ? mbitField((current.bytesPerSecond * 8) / 1_000_000) : '40');
  const kbps = mbitToKib(Number(mbit.replace(',', '.')));

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate({ enabled, kbps: kbps >= 1 ? kbps : 1024 }, { onSuccess: () => setEditing(false) });
  }

  if (!editing) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-2">
        {current?.enabled ? <>Tempo-Limit {formatBitrate(current.bytesPerSecond * 8)}</> : 'Kein Tempo-Limit'}
        <button type="button" onClick={() => setEditing(true)} className="font-medium text-accent hover:underline">
          ändern
        </button>
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="size-4 accent-accent" />
        Begrenzen auf
      </label>
      <input
        inputMode="decimal"
        value={mbit}
        onChange={(event) => setMbit(event.target.value)}
        disabled={!enabled}
        aria-label="Tempo-Limit in Mbit/s"
        className="w-20 rounded-lg border border-line bg-card px-2 py-1 tabular-nums outline-none focus:border-accent focus:ring-3 focus:ring-accent/20 disabled:opacity-50"
      />
      Mbit/s
      <button type="submit" disabled={save.isPending || (enabled && !(kbps >= 1))} className={button}>
        Setzen
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-ink-2 hover:text-ink">
        Abbrechen
      </button>
      {save.isError && <span className="w-full text-critical">{save.error.message}</span>}
    </form>
  );
}

/** "3 fertig, 2 entpackt: names"; on the JDownloader page it opens to their rows. */
function FinishedPackages({ packages, expandable }: { packages: JDownloaderPackage[]; expandable: boolean }) {
  const [open, setOpen] = useState(false);
  const picker = useContext(PickerContext);
  const unpacked = packages.filter((pkg) => pkg.extraction?.state === 'done').length;
  const names = packages.map((pkg) => pkg.name);
  const label = (
    <b className="font-medium text-ink">
      {packages.length} fertig{unpacked ? `, ${unpacked} entpackt` : ''}:
    </b>
  );
  if (!expandable) {
    return (
      <p className="truncate text-xs text-ink-2" title={names.join('\n')}>
        {label} {names.join(', ')}
      </p>
    );
  }
  return (
    <div>
      <div className="flex items-center gap-2">
        {picker && <Tick state={groupState(picker.selection, packages)} label="Alle fertigen Pakete auswählen" onChange={() => picker.pickGroup(packages)} />}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="finished-packages"
          className="flex w-full min-w-0 items-center gap-1.5 text-left text-xs text-ink-2 hover:text-ink"
        >
          <ChevronDown className={clsx('size-4 shrink-0 text-ink-3 transition', !open && '-rotate-90')} aria-hidden />
          <span className="min-w-0 truncate">
            {label} {!open && names.join(', ')}
          </span>
        </button>
      </div>
      {open && (
        <ul id="finished-packages" className="mt-3 space-y-3">
          {packages.map((pkg) => (
            <PackageRow key={pkg.uuid} pkg={pkg} expandable />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Unpacking replaces "100 %" once the download is done; while parts still download, both show. */
function showsExtraction(extraction: JDownloaderExtraction | null | undefined, finished: boolean): extraction is JDownloaderExtraction {
  return Boolean(extraction && (extraction.state !== 'done' || finished));
}

function PackageRow({ pkg, expandable = false }: { pkg: JDownloaderPackage; expandable?: boolean }) {
  const [open, setOpen] = useState(false);
  const picker = useContext(PickerContext);
  const state = picker ? packageState(picker.selection, pkg) : 'none';
  // Parts come only from agent 0.10.0 on, and only for the JDownloader page.
  const parts = expandable ? pkg.links : undefined;
  const extraction = showsExtraction(pkg.extraction, pkg.finished) ? pkg.extraction : null;
  const share = pkg.bytesTotal > 0 ? Math.min(1, pkg.bytesLoaded / pkg.bytesTotal) : pkg.finished ? 1 : 0;
  const details = [
    pkg.bytesTotal > 0 ? (pkg.finished ? formatBytes(pkg.bytesTotal) : `${formatBytes(pkg.bytesLoaded)} von ${formatBytes(pkg.bytesTotal)}`) : null,
    pkg.running && pkg.speedBps > 0 ? formatBitrate(pkg.speedBps * 8) : null,
    pkg.running && pkg.eta !== null ? `noch ${formatEta(pkg.eta)}` : null,
    pkg.childCount > 1 ? `${pkg.childCount} Dateien` : null,
    !pkg.enabled ? 'deaktiviert' : null,
    // JDownloader's package text only repeats what the unpacking says.
    pkg.extraction ? null : pkg.status,
  ].filter(Boolean);
  const name = (
    <span className="min-w-0 truncate font-medium" title={pkg.saveTo ?? undefined}>
      {pkg.name}
    </span>
  );

  return (
    <li className={clsx(picker && '-mx-2 rounded-lg px-2 py-1 transition', state !== 'none' && 'bg-accent/8')}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-baseline gap-2">
          {picker && <Tick state={state} label={`${pkg.name} auswählen`} onChange={(shift) => picker.pickPackage(pkg, shift)} className="self-center" />}
          {parts ? (
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-controls={`parts-${pkg.uuid}`}
              className="flex min-w-0 items-baseline gap-1.5 text-left hover:text-accent"
            >
              <ChevronDown className={clsx('size-4 shrink-0 self-center text-ink-3 transition', !open && '-rotate-90')} aria-hidden />
              {name}
            </button>
          ) : (
            name
          )}
        </span>
        <Progress extraction={extraction} share={share} finished={pkg.finished} />
      </div>
      <div className={clsx(picker ? (parts ? 'pl-11.5' : 'pl-6') : parts && 'pl-5.5')}>
        <p className="truncate text-xs text-ink-3">{details.join(' · ')}</p>
        {extraction?.state === 'failed' && extraction.message && <p className="text-xs text-critical">{extraction.message}</p>}
        <Bar label={pkg.name} extraction={extraction} share={share} running={pkg.running} finished={pkg.finished} />
      </div>
      {open && parts && <PartList id={`parts-${pkg.uuid}`} pkg={pkg} parts={parts} />}
    </li>
  );
}

/** The parts of an opened package; finished ones can be hidden, and the next opened package remembers that. */
function PartList({ id, pkg, parts }: { id: string; pkg: JDownloaderPackage; parts: JDownloaderLink[] }) {
  const [hideFinished, setHideFinished] = usePersistentFlag('manelly.jdownloader.hideFinishedParts', false);
  const picker = useContext(PickerContext);
  const finished = parts.filter((link) => link.finished).length;
  const shown = hideFinished ? parts.filter((link) => !link.finished) : parts;
  return (
    <div id={id} className={clsx('mt-2 rounded-xl border border-line', picker ? 'ml-11.5' : 'ml-5.5')}>
      {parts.length > 0 && (
        <label className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-xs text-ink-2">
          <input type="checkbox" checked={hideFinished} onChange={(event) => setHideFinished(event.target.checked)} className="size-3.5 accent-accent" />
          Fertige ausblenden
          <span className="text-ink-3 tabular-nums">
            · {finished} von {parts.length} fertig
          </span>
        </label>
      )}
      <ul className="divide-y divide-line">
        {parts.length === 0 && <li className="px-3 py-2 text-xs text-ink-3">JDownloader hat für dieses Paket keine Dateien gemeldet.</li>}
        {parts.length > 0 && shown.length === 0 && <li className="px-3 py-2 text-xs text-ink-3">Alle Dateien sind fertig.</li>}
        {shown.map((link) => (
          <PartRow
            key={link.uuid}
            link={link}
            ticked={picker ? linkSelected(picker.selection, pkg, link.uuid) : null}
            onPick={(shift) =>
              picker?.pickLink(
                pkg,
                shown.map((each) => each.uuid),
                link.uuid,
                shift,
              )
            }
          />
        ))}
      </ul>
    </div>
  );
}

/** One file of a package, e.g. "Film.part03.rar", with its own progress. */
function PartRow({ link, ticked, onPick }: { link: JDownloaderLink; ticked: boolean | null; onPick: (shift: boolean) => void }) {
  const extraction = showsExtraction(link.extraction, link.finished) ? link.extraction : null;
  const share = link.bytesTotal > 0 ? Math.min(1, link.bytesLoaded / link.bytesTotal) : link.finished ? 1 : 0;
  const details = [
    link.host,
    link.bytesTotal > 0 ? (link.finished ? formatBytes(link.bytesTotal) : `${formatBytes(link.bytesLoaded)} von ${formatBytes(link.bytesTotal)}`) : null,
    link.running && link.speedBps > 0 ? formatBitrate(link.speedBps * 8) : null,
    link.running && link.eta !== null ? `noch ${formatEta(link.eta)}` : null,
    !link.enabled ? 'deaktiviert' : null,
    // While unpacking or once unpacked the status only says so again; a failure keeps its reason.
    extraction && extraction.state !== 'failed' ? null : link.status,
  ].filter(Boolean);
  return (
    <li className={clsx('px-3 py-2', !link.enabled && 'opacity-60', ticked && 'bg-accent/8')}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-baseline gap-2">
          {ticked !== null && <Tick state={ticked ? 'all' : 'none'} label={`${link.name} auswählen`} onChange={onPick} className="self-center" />}
          <span className="min-w-0 truncate" title={link.name}>
            {link.name}
          </span>
        </span>
        <Progress extraction={extraction} share={share} finished={link.finished} />
      </div>
      <div className={clsx(ticked !== null && 'pl-6')}>
        <p className={clsx('truncate text-xs', extraction?.state === 'failed' ? 'text-critical' : 'text-ink-3')}>{details.join(' · ')}</p>
        <Bar label={link.name} extraction={extraction} share={share} running={link.running} finished={link.finished} thin />
      </div>
    </li>
  );
}

/** "38 %", "Entpacken 40 %", "entpackt"; the icon in the status color, the words in ink. */
function Progress({ extraction, share, finished }: { extraction: JDownloaderExtraction | null; share: number; finished: boolean }) {
  const percent = `${Math.floor(share * 100)} %`;
  if (!extraction) return <span className="shrink-0 text-ink-2 tabular-nums">{percent}</span>;
  const { icon: Icon, tone, label } = {
    running: { icon: LoaderCircle, tone: 'animate-spin text-info', label: `Entpacken${extraction.percent !== null ? ` ${extraction.percent} %` : ' …'}` },
    done: { icon: CircleCheck, tone: 'text-good', label: 'entpackt' },
    failed: { icon: CircleX, tone: 'text-critical', label: 'Entpacken fehlgeschlagen' },
  }[extraction.state];
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-2 tabular-nums">
      <Icon className={clsx('size-3.5 shrink-0 self-center', tone)} aria-hidden />
      {label}
      {!finished && <span className="text-sm">· {percent}</span>}
    </span>
  );
}

/** The download, or once it is done the unpacking in the info color (pulsing while JDownloader gives no percentage). */
function Bar({
  label,
  extraction,
  share,
  running,
  finished,
  thin = false,
}: {
  label: string;
  extraction: JDownloaderExtraction | null;
  share: number;
  running: boolean;
  finished: boolean;
  thin?: boolean;
}) {
  const unpacking = finished && extraction?.state === 'running';
  const percent = unpacking ? extraction.percent : Math.floor(share * 100);
  return (
    <div
      className={clsx('mt-1.5 rounded-full bg-card-2', thin ? 'h-1' : 'h-1.5')}
      role="progressbar"
      aria-label={unpacking ? `${label} entpacken` : label}
      aria-valuenow={percent ?? undefined}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={clsx(
          'h-full rounded-full transition-[width] duration-700',
          unpacking ? (percent === null ? 'animate-pulse bg-info/50' : 'bg-info') : running ? 'bg-accent' : 'bg-ink-3/45',
        )}
        style={{ width: `${Math.max(percent ?? 100, 1)}%` }}
      />
    </div>
  );
}
