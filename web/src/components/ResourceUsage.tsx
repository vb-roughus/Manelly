import type { AgentResourceStatus, GpuUsage, ResourcePoint, ResourceProcess, ResourceRole, ResourceShares } from '@manelly/shared';
import { Cpu, LoaderCircle, MonitorCog } from 'lucide-react';
import clsx from 'clsx';
import { HistoryChart, type ChartSeries } from './HistoryChart';

/** Whose share comes first: on the dashboard Jellyfin's FFmpeg, with a conversion the agent's tools. */
export type ResourceFocus = 'jellyfin' | 'conversion';

const ROLES = {
  jellyfin: { label: 'Jellyfin (FFmpeg)', swatch: 'bg-series-jellyfin', stroke: 'stroke-series-jellyfin', fill: 'fill-series-jellyfin' },
  conversion: { label: 'Umwandlung', swatch: 'bg-series-conversion', stroke: 'stroke-series-conversion', fill: 'fill-series-conversion' },
  other: { label: 'Übrige Prozesse', swatch: 'bg-ink-3/45', stroke: 'stroke-ink-3', fill: 'fill-ink-3' },
} as const;

const ENGINES: Record<string, string> = {
  VideoDecode: 'Video-Dekodierung',
  VideoEncode: 'Video-Kodierung',
  VideoProcessing: 'Videoverarbeitung',
  '3D': '3D',
  Compute: 'Compute',
  Copy: 'Kopieren',
  Total: 'Gesamt',
};

const percent = (value: number) => (value > 0 && value < 1 ? '< 1 %' : `${Math.round(value)} %`);

const order = (focus: ResourceFocus): Array<'jellyfin' | 'conversion'> => (focus === 'jellyfin' ? ['jellyfin', 'conversion'] : ['conversion', 'jellyfin']);

interface ResourceUsageProps {
  data: AgentResourceStatus | undefined;
  error: Error | null;
  focus: ResourceFocus;
}

/** How busy CPU and GPU of the Jellyfin server are, and how much of it Jellyfin's FFmpeg and the conversion use. */
export function ResourceUsage({ data, error, focus }: ResourceUsageProps) {
  if (!data) {
    return error ? (
      <p className="text-sm text-critical">{error.message}</p>
    ) : (
      <p className="flex items-center gap-2 text-sm text-ink-2">
        <LoaderCircle className="size-4 animate-spin" aria-hidden /> Frage den Agent …
      </p>
    );
  }
  if (data.error) return <p className="text-sm text-critical">{data.error}</p>;
  if (!data.cpu) return <p className="text-sm text-ink-2">Misst … die ersten Werte folgen in wenigen Sekunden.</p>;

  return (
    <div className="space-y-5">
      <section aria-label="CPU">
        <Header icon={Cpu} title="CPU" detail={`${data.cpu.model ?? 'Prozessor'} · ${data.cpu.cores} Kerne`} value={percent(data.cpu.total)} />
        <ShareBar shares={data.cpu} focus={focus} />
        <Legend shares={data.cpu} focus={focus} />
        <ShareChart history={data.history} intervalMs={data.intervalMs} focus={focus} kind="cpu" />
      </section>

      {data.gpus.length === 0 ? (
        data.gpuNote && <p className="text-sm text-ink-2">GPU: {data.gpuNote}</p>
      ) : (
        <section aria-label="GPU" className="space-y-4">
          {data.gpus.map((gpu) => (
            <GpuBlock key={gpu.id} gpu={gpu} focus={focus} />
          ))}
          {data.gpus.some((gpu) => gpu.sharesKnown) && (
            <div>
              <p className="text-xs text-ink-2">Verlauf der am stärksten ausgelasteten GPU-Einheit</p>
              <ShareChart history={data.history} intervalMs={data.intervalMs} focus={focus} kind="gpu" />
            </div>
          )}
        </section>
      )}

      <Processes processes={data.processes} focus={focus} />
    </div>
  );
}

function Header({ icon: Icon, title, detail, value }: { icon: typeof Cpu; title: string; detail: string; value: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h4 className="flex min-w-0 items-baseline gap-2">
        <Icon className="size-4 shrink-0 self-center text-accent" aria-hidden />
        <span className="font-semibold">{title}</span>
        <span className="truncate text-xs text-ink-3">{detail}</span>
      </h4>
      <span className="shrink-0 text-xl font-semibold tabular-nums">{value}</span>
    </div>
  );
}

/** Total use as one bar: the focused share first, then the other one, then everything else. */
function ShareBar({ shares, focus, known = true, label }: { shares: ResourceShares; focus: ResourceFocus; known?: boolean; label?: string }) {
  const rest = Math.max(0, shares.total - (known ? shares.jellyfin + shares.conversion : 0));
  const segments = [...(known ? order(focus).map((role) => ({ role, value: shares[role] })) : []), { role: 'other' as const, value: rest }].filter((segment) => segment.value > 0);
  return (
    <div
      className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-card-2"
      role="meter"
      aria-label={label ?? 'Auslastung'}
      aria-valuenow={Math.round(shares.total)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {segments.map((segment) => (
        <div key={segment.role} className={clsx('h-full rounded-full transition-[width] duration-700', ROLES[segment.role].swatch)} style={{ width: `${Math.min(100, segment.value)}%` }} />
      ))}
    </div>
  );
}

function Legend({ shares, focus }: { shares: ResourceShares; focus: ResourceFocus }) {
  const rest = Math.max(0, shares.total - shares.jellyfin - shares.conversion);
  const entries = [...order(focus).map((role) => ({ role, value: shares[role] })), { role: 'other' as const, value: rest }];
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {entries.map((entry) => (
        <li key={entry.role} className="flex items-center gap-1.5">
          <span className={clsx('size-2 rounded-full', ROLES[entry.role].swatch)} aria-hidden />
          {ROLES[entry.role].label}
          <b className="text-ink tabular-nums">{percent(entry.value)}</b>
        </li>
      ))}
    </ul>
  );
}

function GpuBlock({ gpu, focus }: { gpu: GpuUsage; focus: ResourceFocus }) {
  const busiest = gpu.engines[0];
  return (
    <div>
      <Header icon={MonitorCog} title="GPU" detail={gpu.name} value={busiest ? percent(busiest.total) : '–'} />
      <ul className="space-y-2">
        {gpu.engines.map((engine) => (
          <li key={engine.type} className="grid grid-cols-[minmax(7rem,9rem)_1fr_3rem] items-center gap-3 text-xs">
            <span className="truncate text-ink-2">{ENGINES[engine.type] ?? engine.type}</span>
            <ShareBar shares={engine} focus={focus} known={gpu.sharesKnown} label={ENGINES[engine.type] ?? engine.type} />
            <span className="text-right font-medium tabular-nums">{percent(engine.total)}</span>
          </li>
        ))}
      </ul>
      {gpu.sharesKnown ? (
        <Legend shares={busiest ?? { total: 0, jellyfin: 0, conversion: 0 }} focus={focus} />
      ) : (
        <p className="mt-2 text-xs text-ink-3">Wie viel davon auf Jellyfin entfällt, verrät Linux hier nicht.</p>
      )}
    </div>
  );
}

const SERIES: Record<'cpu' | 'gpu', Record<'total' | 'jellyfin' | 'conversion', ChartSeries<ResourcePoint>['key']>> = {
  cpu: { total: 'cpu', jellyfin: 'cpuJellyfin', conversion: 'cpuConversion' },
  gpu: { total: 'gpu', jellyfin: 'gpuJellyfin', conversion: 'gpuConversion' },
};

/** Total use as a thin line, the shares of Jellyfin and the conversion in their colors. */
function ShareChart({ history, intervalMs, focus, kind }: { history: ResourcePoint[]; intervalMs: number; focus: ResourceFocus; kind: 'cpu' | 'gpu' }) {
  const keys = SERIES[kind];
  const series: Array<ChartSeries<ResourcePoint>> = [
    ...order(focus).map((role) => ({ key: keys[role], label: ROLES[role].label, stroke: ROLES[role].stroke, fill: ROLES[role].fill, swatch: ROLES[role].swatch })),
    { key: keys.total, label: 'Gesamt', stroke: 'stroke-ink-3', fill: 'fill-ink-3', swatch: 'bg-ink-3', thin: true },
  ];
  return <HistoryChart points={history} series={series} top={100} format={percent} intervalMs={intervalMs} />;
}

const ROLE_NAMES: Record<ResourceRole, string> = { jellyfin: 'Jellyfin', conversion: 'Umwandlung', other: 'Anderer Prozess' };

function Processes({ processes, focus }: { processes: ResourceProcess[]; focus: ResourceFocus }) {
  return (
    <section aria-label="Prozesse">
      <h4 className="mb-2 text-sm font-semibold">Prozesse</h4>
      {processes.length === 0 ? (
        <p className="text-sm text-ink-2">Gerade läuft weder FFmpeg noch ein Werkzeug der Umwandlung.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-left text-ink-3">
            <tr>
              <th className="pb-1 font-normal">Prozess</th>
              <th className="pb-1 font-normal">Gehört zu</th>
              <th className="pb-1 text-right font-normal">CPU</th>
              <th className="pb-1 text-right font-normal">GPU</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {processes.map((process) => (
              <tr key={process.pid} className={clsx(process.role === focus && 'font-medium')}>
                <td className="py-1">
                  {process.name} <span className="text-ink-3">#{process.pid}</span>
                </td>
                <td className="py-1">
                  <span className="flex items-center gap-1.5">
                    <span className={clsx('size-2 rounded-full', ROLES[process.role].swatch)} aria-hidden />
                    {ROLE_NAMES[process.role]}
                  </span>
                </td>
                <td className="py-1 text-right tabular-nums">{percent(process.cpu)}</td>
                <td className="py-1 text-right tabular-nums">{process.gpu === null ? '–' : percent(process.gpu)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
