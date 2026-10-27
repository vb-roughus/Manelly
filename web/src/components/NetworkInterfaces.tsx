import { Link } from 'react-router';
import type { AgentNetworkStatus, MonitoredInterface, NetworkRatePoint } from '@manelly/shared';
import { TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import { formatBitrate } from '../lib/format';
import { HistoryChart, type ChartSeries } from './HistoryChart';

/**
 * Send and receive rates of the Jellyfin server's interfaces picked in the settings,
 * or where to pick them (with the agent) when there are none.
 */
export function NetworkInterfaces({ data, agentConfigured }: { data: AgentNetworkStatus | undefined; agentConfigured: boolean }) {
  if (!data || data.interfaces.length === 0) {
    return (
      <p className="text-sm text-ink-2">
        {agentConfigured
          ? 'Wähle die Netzwerkschnittstellen des Servers, um hier ihre Auslastung zu sehen: '
          : 'Mit dem Manelly-Agent auf dem Jellyfin-Server siehst du hier auch die Auslastung seiner Netzwerkschnittstellen: '}
        <Link to={agentConfigured ? '/settings#network' : '/server/agent'} className="font-medium text-accent hover:underline">
          {agentConfigured ? 'Einstellungen' : 'Server → Agent'}
        </Link>
      </p>
    );
  }
  return (
    <>
      {data.error && <p className="mb-3 text-sm text-critical">{data.error}</p>}
      <ul className="grid gap-3 md:grid-cols-2">
        {data.interfaces.map((nic) => (
          <li key={nic.id}>
            <InterfaceTile nic={nic} intervalMs={data.intervalMs} />
          </li>
        ))}
      </ul>
    </>
  );
}

const rate = (bps: number | null) => (bps === null ? '–' : formatBitrate(bps));

function InterfaceTile({ nic, intervalMs }: { nic: MonitoredInterface; intervalMs: number }) {
  const measuring = nic.rxBps === null || nic.txBps === null;
  return (
    <article className="h-full rounded-xl border border-line p-4">
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

/** Rounds the top of the scale up to 1, 2 or 5 times a power of ten (at least 1 Mbit/s). */
function niceMax(value: number): number {
  const target = Math.max(value, 1_000_000);
  const power = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 5, 10].map((step) => step * power).find((candidate) => candidate >= target) ?? target;
}

const RATE_SERIES: Array<ChartSeries<NetworkRatePoint>> = [
  { key: 'txBps', label: 'Senden', stroke: 'stroke-series-send', fill: 'fill-series-send', swatch: 'bg-series-send' },
  { key: 'rxBps', label: 'Empfangen', stroke: 'stroke-series-receive', fill: 'fill-series-receive', swatch: 'bg-series-receive' },
];

/** Send and receive over the last ten minutes, on one scale. */
function RateChart({ history, intervalMs }: { history: NetworkRatePoint[]; intervalMs: number }) {
  const top = niceMax(Math.max(0, ...history.map((entry) => Math.max(entry.rxBps, entry.txBps))));
  return <HistoryChart points={history} series={RATE_SERIES} top={top} format={formatBitrate} intervalMs={intervalMs} />;
}
