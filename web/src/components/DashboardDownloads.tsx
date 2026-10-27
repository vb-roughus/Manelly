import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { JDownloaderPackage, JDownloaderStatus } from '@manelly/shared';
import { ChevronDown, Download, Gauge, Pause, Play, Square } from 'lucide-react';
import clsx from 'clsx';
import { useAgent, useAgentSettings, useControlJDownloader, useJDownloader, useJDownloaderLimit } from '../hooks/queries';
import { usePersistentFlag } from '../hooks/usePersistentFlag';
import { formatBytes, formatEta, formatSpeed } from '../lib/format';

const MAX_SHOWN = 6;

const STATES: Record<string, string> = { RUNNING: 'lädt', PAUSE: 'pausiert', IDLE: 'bereit', STOPPING: 'hält an', STOPPED: 'gestoppt' };

/** JDownloader on the Jellyfin server: state, speed, packages, controls; only when switched on in the settings. */
export function DashboardDownloads() {
  const agentSettings = useAgentSettings();
  const agent = useAgent({ enabled: Boolean(agentSettings.data?.url && agentSettings.data.hasToken) });
  const enabled = Boolean(agent.data?.status?.jdownloader?.enabled);
  const { data } = useJDownloader(enabled);
  const [open, setOpen] = usePersistentFlag('manelly.dashboard.downloads.open', true);
  if (!enabled || !data) return null;

  const state = data.state ? (STATES[data.state] ?? data.state.toLowerCase()) : null;
  const summary = data.reachable
    ? [state, data.state === 'RUNNING' && data.speedBps ? formatSpeed(data.speedBps) : null, data.throttling.active ? 'gebremst' : null].filter(Boolean).join(' · ')
    : 'nicht erreichbar';

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
        <Link to="/settings" className="text-sm font-medium text-accent hover:underline">
          JDownloader einstellen
        </Link>
      </div>
      <div id="downloads-content" hidden={!open} className="rounded-2xl border border-line bg-card p-4 shadow-sm shadow-black/5">
        {data.reachable ? <Downloads status={data} /> : <p className="text-sm text-critical">{data.error}</p>}
      </div>
    </section>
  );
}

function Downloads({ status }: { status: JDownloaderStatus }) {
  const unfinished = status.packages.filter((pkg) => !pkg.finished);
  const finished = status.packages.filter((pkg) => pkg.finished);
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
          {unfinished.length > 0 && (
            <ul className="space-y-3">
              {unfinished.slice(0, MAX_SHOWN).map((pkg) => (
                <PackageRow key={pkg.uuid} pkg={pkg} />
              ))}
            </ul>
          )}
          {unfinished.length > MAX_SHOWN && <p className="text-xs text-ink-3">und {unfinished.length - MAX_SHOWN} weitere Pakete in der Warteschlange</p>}
          {finished.length > 0 && (
            <p className="truncate text-xs text-ink-2" title={finished.map((pkg) => pkg.name).join('\n')}>
              <b className="font-medium text-ink">{finished.length} fertig:</b> {finished.map((pkg) => pkg.name).join(', ')}
            </p>
          )}
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

function PackageRow({ pkg }: { pkg: JDownloaderPackage }) {
  const share = pkg.bytesTotal > 0 ? Math.min(1, pkg.bytesLoaded / pkg.bytesTotal) : 0;
  const details = [
    pkg.bytesTotal > 0 ? `${formatBytes(pkg.bytesLoaded)} von ${formatBytes(pkg.bytesTotal)}` : null,
    pkg.running && pkg.speedBps > 0 ? formatSpeed(pkg.speedBps) : null,
    pkg.running && pkg.eta !== null ? `noch ${formatEta(pkg.eta)}` : null,
    pkg.childCount > 1 ? `${pkg.childCount} Dateien` : null,
    !pkg.enabled ? 'deaktiviert' : null,
  ].filter(Boolean);
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <p className="min-w-0 truncate font-medium" title={pkg.saveTo ?? undefined}>
          {pkg.name}
        </p>
        <p className="shrink-0 tabular-nums text-ink-2">{Math.floor(share * 100)} %</p>
      </div>
      <p className="truncate text-xs text-ink-3">{[...details, pkg.status].filter(Boolean).join(' · ')}</p>
      <div className="mt-1.5 h-1.5 rounded-full bg-card-2" role="progressbar" aria-label={pkg.name} aria-valuenow={Math.floor(share * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className={clsx('h-full rounded-full transition-[width] duration-700', pkg.running ? 'bg-accent' : 'bg-ink-3/45')} style={{ width: `${Math.max(share * 100, 1)}%` }} />
      </div>
    </li>
  );
}
