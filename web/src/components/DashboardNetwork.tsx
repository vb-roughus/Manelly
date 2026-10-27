import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { Link } from 'react-router';
import type { MonitoredInterface, NetworkRatePoint } from '@manelly/shared';
import { Network, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import { useAgentNetwork, useAgentSettings } from '../hooks/queries';
import { formatBitrate } from '../lib/format';

const WINDOW_MS = 10 * 60_000;

/** Send and receive rates of the Jellyfin server's interfaces picked in the settings; nothing without them. */
export function DashboardNetwork() {
  const settings = useAgentSettings();
  const configured = Boolean(settings.data?.url && settings.data.hasToken);
  const { data } = useAgentNetwork(configured);
  if (!data || data.interfaces.length === 0) return null;

  return (
    <section aria-labelledby="network-heading">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="network-heading" className="flex items-center gap-2 text-lg font-semibold">
          <Network className="size-4 text-accent" aria-hidden />
          Netzwerk des Servers
        </h2>
        <Link to="/settings" className="text-sm font-medium text-accent hover:underline">
          Schnittstellen wählen
        </Link>
      </div>
      {data.error && <p className="mb-3 text-sm text-critical">{data.error}</p>}
      <ul className="grid gap-3 md:grid-cols-2">
        {data.interfaces.map((nic) => (
          <li key={nic.id}>
            <InterfaceTile nic={nic} intervalMs={data.intervalMs} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const rate = (bps: number | null) => (bps === null ? '–' : formatBitrate(bps));

function InterfaceTile({ nic, intervalMs }: { nic: MonitoredInterface; intervalMs: number }) {
  const measuring = nic.rxBps === null || nic.txBps === null;
  return (
    <article className="h-full rounded-2xl border border-line bg-card p-4 shadow-sm shadow-black/5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{nic.name}</h3>
          {nic.description && nic.description !== nic.name && <p className="truncate text-xs text-ink-3">{nic.description}</p>}
        </div>
        <span className={clsx('shrink-0 text-xs', nic.up ? 'text-ink-2' : 'text-critical')}>
          {nic.up ? (nic.speedBps ? `Link ${formatBitrate(nic.speedBps)}` : 'verbunden') : 'getrennt'}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3">
        <Figure label="Senden" hint="Vom Server weg – darin stecken die Streams" swatch="bg-series-send" value={rate(nic.txBps)} />
        <Figure label="Empfangen" hint="Zum Server hin" swatch="bg-series-receive" value={rate(nic.rxBps)} />
      </dl>
      {measuring ? (
        <p className="mt-3 text-xs text-ink-3">Misst … die ersten Werte folgen in wenigen Sekunden.</p>
      ) : (
        <Utilization nic={nic} />
      )}
      <RateChart history={nic.history} intervalMs={intervalMs} />
    </article>
  );
}

function Figure({ label, hint, swatch, value }: { label: string; hint: string; swatch: string; value: string }) {
  return (
    <div title={hint}>
      <dt className="flex items-center gap-1.5 text-xs text-ink-2">
        <span className={clsx('size-2 rounded-full', swatch)} aria-hidden />
        {label}
      </dt>
      <dd className="mt-0.5 text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** The busier direction against the link speed. */
function Utilization({ nic }: { nic: MonitoredInterface }) {
  if (!nic.speedBps || nic.txBps === null || nic.rxBps === null) return null;
  const sending = nic.txBps >= nic.rxBps;
  const share = Math.min(1, Math.max(nic.txBps, nic.rxBps) / nic.speedBps);
  const percent = share * 100;
  const level = share >= 0.9 ? 'critical' : share >= 0.7 ? 'warning' : 'normal';
  const colors = {
    normal: { fill: 'bg-accent', track: 'bg-accent/15' },
    warning: { fill: 'bg-warning', track: 'bg-warning/20' },
    critical: { fill: 'bg-critical', track: 'bg-critical/15' },
  }[level];
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-2 text-xs text-ink-2">
        <span className="flex items-center gap-1">
          {level !== 'normal' && <TriangleAlert className={clsx('size-3.5', level === 'critical' ? 'text-critical' : 'text-warning')} aria-hidden />}
          {level === 'critical' ? 'Am Limit' : level === 'warning' ? 'Hoch ausgelastet' : 'Auslastung'} ({sending ? 'Senden' : 'Empfangen'})
        </span>
        <span className="tabular-nums">
          {percent < 1 ? '< 1' : Math.round(percent)} % von {formatBitrate(nic.speedBps)}
        </span>
      </div>
      <div className={clsx('mt-1 h-1.5 overflow-hidden rounded-full', colors.track)} role="meter" aria-label="Auslastung" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
        <div className={clsx('h-full rounded-full transition-[width] duration-700', colors.fill)} style={{ width: `${Math.max(percent, 0.5)}%` }} />
      </div>
    </div>
  );
}

const HEIGHT = 72;
const PAD = 4;

/** Rounds the top of the scale up to 1, 2 or 5 times a power of ten (at least 1 Mbit/s). */
function niceMax(value: number): number {
  const target = Math.max(value, 1_000_000);
  const power = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 5, 10].map((step) => step * power).find((candidate) => candidate >= target) ?? target;
}

const clock = (t: number) => new Date(t).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Send and receive over the last ten minutes, on one scale; a crosshair shows the values at a point in time. */
function RateChart({ history, intervalMs }: { history: NetworkRatePoint[]; intervalMs: number }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const [active, setActive] = useState<number | null>(null);
  const point = active !== null ? history[active] : undefined;

  const end = history.at(-1)?.t ?? Date.now();
  const start = end - WINDOW_MS;
  const top = niceMax(Math.max(0, ...history.map((entry) => Math.max(entry.rxBps, entry.txBps))));
  const x = (t: number) => ((t - start) / WINDOW_MS) * width;
  const y = (value: number) => HEIGHT - PAD - ((HEIGHT - 2 * PAD) * value) / top;

  // Gaps (the agent did not measure) break the line instead of bridging them.
  const path = (key: 'rxBps' | 'txBps') =>
    history
      .map((entry, index) => {
        const jump = index === 0 || entry.t - history[index - 1]!.t > 3 * intervalMs;
        return `${jump ? 'M' : 'L'}${x(entry.t).toFixed(1)},${y(entry[key]).toFixed(1)}`;
      })
      .join('');

  function pick(event: PointerEvent<HTMLDivElement>) {
    if (!history.length || !box.current) return;
    const rect = box.current.getBoundingClientRect();
    const t = start + ((event.clientX - rect.left) / rect.width) * WINDOW_MS;
    let nearest = 0;
    history.forEach((entry, index) => {
      if (Math.abs(entry.t - t) < Math.abs(history[nearest]!.t - t)) nearest = index;
    });
    setActive(nearest);
  }

  function step(event: KeyboardEvent<HTMLDivElement>) {
    if (!history.length) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const from = active ?? history.length - 1;
      setActive(Math.min(history.length - 1, Math.max(0, from + (event.key === 'ArrowLeft' ? -1 : 1))));
    }
    if (event.key === 'Escape') setActive(null);
  }

  const latest = history.at(-1);
  const summary = latest
    ? `Verlauf der letzten 10 Minuten, Skala bis ${formatBitrate(top)}. Zuletzt Senden ${formatBitrate(latest.txBps)}, Empfangen ${formatBitrate(latest.rxBps)}.`
    : 'Noch kein Verlauf.';

  return (
    <div className="mt-3">
      <div className="flex justify-between text-[11px] text-ink-3">
        <span>{formatBitrate(top)}</span>
      </div>
      <div
        ref={box}
        role="img"
        aria-label={summary}
        tabIndex={0}
        onPointerMove={pick}
        onPointerLeave={() => setActive(null)}
        onKeyDown={step}
        onBlur={() => setActive(null)}
        className="relative cursor-crosshair rounded outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        style={{ height: HEIGHT }}
      >
        {width > 0 && (
          <svg width={width} height={HEIGHT} className="block overflow-visible" aria-hidden>
            <line x1={0} x2={width} y1={HEIGHT - PAD} y2={HEIGHT - PAD} className="stroke-line" strokeWidth={1} />
            <path d={path('rxBps')} fill="none" className="stroke-series-receive" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <path d={path('txBps')} fill="none" className="stroke-series-send" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {point && (
              <g>
                <line x1={x(point.t)} x2={x(point.t)} y1={0} y2={HEIGHT - PAD} className="stroke-ink-3" strokeWidth={1} />
                <circle cx={x(point.t)} cy={y(point.rxBps)} r={4} className="fill-series-receive stroke-card" strokeWidth={2} />
                <circle cx={x(point.t)} cy={y(point.txBps)} r={4} className="fill-series-send stroke-card" strokeWidth={2} />
              </g>
            )}
          </svg>
        )}
        {point && (
          <div
            className="pointer-events-none absolute -top-2 z-10 w-max -translate-y-full rounded-lg bg-card px-2.5 py-1.5 text-xs shadow-lg ring-1 ring-line"
            style={x(point.t) > width / 2 ? { right: width - x(point.t) } : { left: x(point.t) }}
          >
            <p className="text-ink-3">{clock(point.t)}</p>
            <p className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-series-send" aria-hidden />
              <b className="tabular-nums">{formatBitrate(point.txBps)}</b> <span className="text-ink-2">Senden</span>
            </p>
            <p className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-series-receive" aria-hidden />
              <b className="tabular-nums">{formatBitrate(point.rxBps)}</b> <span className="text-ink-2">Empfangen</span>
            </p>
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-ink-3">
        <span>vor 10 min</span>
        <span>jetzt</span>
      </div>
    </div>
  );
}

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry?.contentRect.width ?? 0)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
