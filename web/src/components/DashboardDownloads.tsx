import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { JDownloaderExtraction, JDownloaderLink, JDownloaderPackage, JDownloaderStatus } from '@manelly/shared';
import { ChevronDown, CircleCheck, CircleX, Download, Gauge, LoaderCircle, Pause, Play, Square } from 'lucide-react';
import clsx from 'clsx';
import { useAgent, useAgentSettings, useControlJDownloader, useJDownloader, useJDownloaderLimit } from '../hooks/queries';
import { usePersistentFlag } from '../hooks/usePersistentFlag';
import { formatBytes, formatEta, formatSpeed } from '../lib/format';

const MAX_SHOWN = 6;

const STATES: Record<string, string> = { RUNNING: 'lädt', PAUSE: 'pausiert', IDLE: 'bereit', STOPPING: 'hält an', STOPPED: 'gestoppt' };

/** Still worth a look: downloading, unpacking after the download, or unpacking failed. */
export function isActivePackage(pkg: JDownloaderPackage): boolean {
  return !pkg.finished || pkg.extraction?.state === 'running' || pkg.extraction?.state === 'failed';
}

/** "lädt · 12 MB/s · gebremst", or why JDownloader does not answer. */
export function downloadsSummary(status: JDownloaderStatus): string {
  if (!status.reachable) return 'nicht erreichbar';
  const state = status.state ? (STATES[status.state] ?? status.state.toLowerCase()) : null;
  // JDownloader calls itself idle while it unpacks.
  const unpacking = status.packages.filter((pkg) => pkg.extraction?.state === 'running').length;
  return [
    state,
    status.state === 'RUNNING' && status.speedBps ? formatSpeed(status.speedBps) : null,
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
  const [open, setOpen] = usePersistentFlag('manelly.dashboard.downloads.open', true);
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
 * and there (`expandable`) every package opens to its parts and the finished ones to their rows.
 */
export function Downloads({ status, maxShown = MAX_SHOWN, expandable = false }: { status: JDownloaderStatus; maxShown?: number; expandable?: boolean }) {
  const active = status.packages.filter(isActivePackage);
  const finished = status.packages.filter((pkg) => !isActivePackage(pkg));
  return (
    <div className="space-y-4">
      <Controls status={status} />
      {status.throttling.reason && (
        <p className="flex items-center gap-2 rounded-lg bg-card-2 px-3 py-2 text-sm">
          <Gauge className="size-4 shrink-0 text-accent" aria-hidden />
          {status.throttling.reason} Danach läuft JDownloader wieder wie vorher.
        </p>
      )}
      {status.packages.length === 0 ? (
        <p className="text-sm text-ink-2">Keine Downloads in der Liste.</p>
      ) : (
        <>
          {active.length > 0 && (
            <ul className="space-y-3">
              {active.slice(0, maxShown).map((pkg) => (
                <PackageRow key={pkg.uuid} pkg={pkg} expandable={expandable} />
              ))}
            </ul>
          )}
          {active.length > maxShown && <p className="text-xs text-ink-3">und {active.length - maxShown} weitere Pakete in der Warteschlange</p>}
          {finished.length > 0 && <FinishedPackages packages={finished} expandable={expandable} />}
        </>
      )}
    </div>
  );
}

const button =
  'inline-flex items-center gap-1.5 rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-ink ring-1 ring-line transition hover:bg-card-2 disabled:cursor-wait disabled:opacity-60';

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
  const [mb, setMb] = useState(current && current.bytesPerSecond > 0 ? String(Math.round((current.bytesPerSecond / 1024 ** 2) * 10) / 10) : '5');
  const kbps = Math.round(Number(mb.replace(',', '.')) * 1024);

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate({ enabled, kbps: kbps >= 1 ? kbps : 1024 }, { onSuccess: () => setEditing(false) });
  }

  if (!editing) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-2">
        {current?.enabled ? <>Tempo-Limit {formatSpeed(current.bytesPerSecond)}</> : 'Kein Tempo-Limit'}
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
        value={mb}
        onChange={(event) => setMb(event.target.value)}
        disabled={!enabled}
        aria-label="Tempo-Limit in MB/s"
        className="w-20 rounded-lg border border-line bg-card px-2 py-1 tabular-nums outline-none focus:border-accent focus:ring-3 focus:ring-accent/20 disabled:opacity-50"
      />
      MB/s
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
  const [open, setOpen] = usePersistentFlag('manelly.jdownloader.finished.open', false);
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
  // Parts come only from agent 0.10.0 on, and only for the JDownloader page.
  const parts = expandable ? pkg.links : undefined;
  const extraction = showsExtraction(pkg.extraction, pkg.finished) ? pkg.extraction : null;
  const share = pkg.bytesTotal > 0 ? Math.min(1, pkg.bytesLoaded / pkg.bytesTotal) : pkg.finished ? 1 : 0;
  const details = [
    pkg.bytesTotal > 0 ? (pkg.finished ? formatBytes(pkg.bytesTotal) : `${formatBytes(pkg.bytesLoaded)} von ${formatBytes(pkg.bytesTotal)}`) : null,
    pkg.running && pkg.speedBps > 0 ? formatSpeed(pkg.speedBps) : null,
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
    <li>
      <div className="flex items-baseline justify-between gap-3 text-sm">
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
        <Progress extraction={extraction} share={share} finished={pkg.finished} />
      </div>
      <div className={clsx(parts && 'pl-5.5')}>
        <p className="truncate text-xs text-ink-3">{details.join(' · ')}</p>
        {extraction?.state === 'failed' && extraction.message && <p className="text-xs text-critical">{extraction.message}</p>}
        <Bar label={pkg.name} extraction={extraction} share={share} running={pkg.running} finished={pkg.finished} />
      </div>
      {open && parts && (
        <ul id={`parts-${pkg.uuid}`} className="mt-2 ml-5.5 divide-y divide-line rounded-xl border border-line">
          {parts.length === 0 && <li className="px-3 py-2 text-xs text-ink-3">JDownloader hat für dieses Paket keine Dateien gemeldet.</li>}
          {parts.map((link) => (
            <PartRow key={link.uuid} link={link} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** One file of a package, e.g. "Film.part03.rar", with its own progress. */
function PartRow({ link }: { link: JDownloaderLink }) {
  const extraction = showsExtraction(link.extraction, link.finished) ? link.extraction : null;
  const share = link.bytesTotal > 0 ? Math.min(1, link.bytesLoaded / link.bytesTotal) : link.finished ? 1 : 0;
  const details = [
    link.host,
    link.bytesTotal > 0 ? (link.finished ? formatBytes(link.bytesTotal) : `${formatBytes(link.bytesLoaded)} von ${formatBytes(link.bytesTotal)}`) : null,
    link.running && link.speedBps > 0 ? formatSpeed(link.speedBps) : null,
    link.running && link.eta !== null ? `noch ${formatEta(link.eta)}` : null,
    !link.enabled ? 'deaktiviert' : null,
    // While unpacking or once unpacked the status only says so again; a failure keeps its reason.
    extraction && extraction.state !== 'failed' ? null : link.status,
  ].filter(Boolean);
  return (
    <li className={clsx('px-3 py-2', !link.enabled && 'opacity-60')}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate" title={link.name}>
          {link.name}
        </span>
        <Progress extraction={extraction} share={share} finished={link.finished} />
      </div>
      <p className={clsx('truncate text-xs', extraction?.state === 'failed' ? 'text-critical' : 'text-ink-3')}>{details.join(' · ')}</p>
      <Bar label={link.name} extraction={extraction} share={share} running={link.running} finished={link.finished} thin />
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
