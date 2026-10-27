import { createContext, useContext, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { PlayMethod, StreamSpan } from '@manelly/shared';
import { Cpu, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { formatMoment, formatTick, nearestPoint, packLanes, spanEnd, timeTicks } from '../lib/timeline';
import { useWidth, type ChartSeries } from './HistoryChart';

interface TimelineState {
  start: number;
  end: number;
  /** Length of one point. */
  step: number;
  width: number;
  /** The time under the crosshair, shared by all charts. */
  active: number | null;
  setActive: (t: number | null) => void;
  /** Stream starts and changes, drawn as thin lines in every chart. */
  markers: Array<{ t: number; transcode: boolean }>;
  /** The selected stream, shaded in every chart. */
  highlight: { start: number; end: number } | null;
}

const TimelineContext = createContext<TimelineState | null>(null);

function useTimeline(): TimelineState & { x: (t: number) => number } {
  const state = useContext(TimelineContext);
  if (!state) throw new Error('Outside a Timeline.');
  return { ...state, x: (t: number) => ((t - state.start) / (state.end - state.start)) * state.width };
}

/** Charts and lanes on one time scale, with one crosshair across all of them. */
export function Timeline({ children, ...state }: Omit<TimelineState, 'width'> & { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  return (
    <div ref={box} className="divide-y divide-line">
      {width > 0 && <TimelineContext.Provider value={{ ...state, width }}>{children}</TimelineContext.Provider>}
    </div>
  );
}

/** Times along the range, on full local hours or days. */
export function TimeAxis() {
  const { start, end, width, x } = useTimeline();
  const { interval, ticks } = timeTicks(start, end, Math.max(2, Math.floor(width / 90)));
  return (
    <div aria-hidden className="relative h-6 text-[11px] text-ink-3">
      {ticks.map((t) => (
        <span key={t} className="absolute top-1.5 -translate-x-1/2 whitespace-nowrap" style={{ left: Math.min(width - 24, Math.max(24, x(t))) }}>
          {formatTick(t, interval)}
        </span>
      ))}
    </div>
  );
}

type Key<T> = ChartSeries<T>['key'];

interface TimelineChartProps<T extends { t: number }> {
  title: string;
  icon: LucideIcon;
  points: T[];
  /** The first series is drawn on top and named first. */
  series: Array<ChartSeries<T>>;
  /** A faint area from the average up to the peak within each point. */
  band?: { low: Key<T>; high: Key<T> };
  top: number;
  format: (value: number) => string;
  /** Shown while the crosshair is elsewhere: what the range holds. */
  summary: ReactNode;
  /** One more fact for the readout at the crosshair. */
  extra?: (point: T) => string | null;
  height?: number;
}

const PAD = 4;

/** One measure over the range; gaps where nothing was recorded. The crosshair's values stand in the header. */
export function TimelineChart<T extends { t: number }>({ title, icon: Icon, points, series, band, top, format, summary, extra, height = 88 }: TimelineChartProps<T>) {
  const { start, end, step, width, active, setActive, markers, highlight, x } = useTimeline();
  const value = (point: T, key: Key<T>) => point[key] as number | null;
  const y = (v: number) => height - PAD - ((height - 2 * PAD) * Math.min(Math.max(v, 0), top)) / top;
  // Records come every 15 s and steps may miss one; a longer silence is a gap.
  const gap = 2.5 * step;

  /** Runs of points without a gap and with a value. */
  function runs(key: Key<T>): T[][] {
    const result: T[][] = [];
    let run: T[] = [];
    for (const point of points) {
      const previous = run.at(-1);
      if (value(point, key) === null || (previous && point.t - previous.t > gap)) {
        if (run.length) result.push(run);
        run = [];
      }
      if (value(point, key) !== null) run.push(point);
    }
    if (run.length) result.push(run);
    return result;
  }

  const line = (run: T[], key: Key<T>) => run.map((point, index) => `${index ? 'L' : 'M'}${x(point.t).toFixed(1)},${y(value(point, key)!).toFixed(1)}`).join('');
  const area = (run: T[], low: Key<T>, high: Key<T>) =>
    `${line(run, high)}${[...run].reverse().map((point) => `L${x(point.t).toFixed(1)},${y(value(point, low) ?? 0).toFixed(1)}`).join('')}Z`;

  const current = active === null ? null : nearestPoint(points, active, step);

  function pick(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const t = start + ((event.clientX - rect.left) / rect.width) * (end - start);
    setActive(nearestPoint(points, t, Number.POSITIVE_INFINITY)?.t ?? null);
  }

  function stepThrough(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') return setActive(null);
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    if (!points.length) return;
    const index = current ? points.indexOf(current) : points.length;
    const next = points[Math.min(points.length - 1, Math.max(0, index + (event.key === 'ArrowLeft' ? -1 : 1)))]!;
    setActive(next.t);
  }

  const readout =
    active === null ? (
      summary
    ) : current ? (
      <>
        <span className="text-ink-3">{formatMoment(current.t, step < 60_000)}</span>
        {series.map((entry) => {
          const v = value(current, entry.key);
          return (
            <span key={String(entry.key)} className="inline-flex items-center gap-1.5">
              <span className={clsx('h-0.5 w-3 rounded-full', entry.swatch)} aria-hidden />
              <b className="font-semibold text-ink tabular-nums">{v === null ? '–' : format(v)}</b> {entry.label}
            </span>
          );
        })}
        {band && value(current, band.high) !== null && value(current, band.high)! > (value(current, band.low) ?? 0) + 0.5 && (
          <span>
            Spitze <b className="font-semibold text-ink tabular-nums">{format(value(current, band.high)!)}</b>
          </span>
        )}
        {extra?.(current)}
      </>
    ) : (
      <span className="text-ink-3">{formatMoment(active, step < 60_000)} – nichts aufgezeichnet</span>
    );

  return (
    <section aria-label={title} className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="size-4 text-accent" aria-hidden />
          {title}
        </h3>
        <p className="flex min-h-4 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2" aria-live="off">
          {readout}
        </p>
      </div>
      <p className="mt-1 text-[11px] text-ink-3">{format(top)}</p>
      <div
        role="img"
        aria-label={`${title}, Skala bis ${format(top)}. Mit den Pfeiltasten durch die Werte gehen.`}
        tabIndex={0}
        onPointerMove={pick}
        onPointerLeave={() => setActive(null)}
        onKeyDown={stepThrough}
        onBlur={() => setActive(null)}
        className="cursor-crosshair rounded outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        style={{ height }}
      >
        <svg width={width} height={height} className="block overflow-visible" aria-hidden>
          {highlight && (
            <rect x={Math.max(0, x(highlight.start))} width={Math.max(2, Math.min(width, x(highlight.end)) - Math.max(0, x(highlight.start)))} y={0} height={height - PAD} className="fill-accent/10" />
          )}
          <line x1={0} x2={width} y1={height - PAD} y2={height - PAD} className="stroke-line" strokeWidth={1} />
          {markers.filter((marker) => marker.t >= start && marker.t <= end).map((marker) => (
            <line
              key={`${marker.t}-${marker.transcode}`}
              x1={x(marker.t)}
              x2={x(marker.t)}
              y1={0}
              y2={height - PAD}
              className={marker.transcode ? 'stroke-warning/70' : 'stroke-ink-3/40'}
              strokeWidth={1}
              strokeDasharray="2 3"
            />
          ))}
          {band && runs(band.high).map((run) => <path key={`band-${run[0]!.t}`} d={area(run, band.low, band.high)} className="fill-ink-3/15" />)}
          {[...series].reverse().map((entry) =>
            runs(entry.key).map((run) =>
              run.length === 1 ? (
                <circle key={`${String(entry.key)}-${run[0]!.t}`} cx={x(run[0]!.t)} cy={y(value(run[0]!, entry.key)!)} r={1.5} className={entry.fill} />
              ) : (
                <path
                  key={`${String(entry.key)}-${run[0]!.t}`}
                  d={line(run, entry.key)}
                  fill="none"
                  className={entry.stroke}
                  strokeWidth={entry.thin ? 1.25 : 1.75}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ),
            ),
          )}
          {active !== null && (
            <g>
              <line x1={x(active)} x2={x(active)} y1={0} y2={height - PAD} className="stroke-ink-3" strokeWidth={1} />
              {current &&
                [...series].reverse().map((entry) => {
                  const v = value(current, entry.key);
                  return v === null ? null : <circle key={String(entry.key)} cx={x(current.t)} cy={y(v)} r={4} className={clsx(entry.fill, 'stroke-card')} strokeWidth={2} />;
                })}
            </g>
          )}
        </svg>
      </div>
    </section>
  );
}

const LANE_HEIGHT = 26;
const MIN_BAR = 6;

/** How each part of a bar is tinted: like the play method badges on the dashboard. */
const TONES: Record<PlayMethod, string> = {
  DirectPlay: 'bg-good/25',
  Remux: 'bg-info/25',
  DirectStream: 'bg-info/25',
  Transcode: 'bg-warning/40',
};

export const LANE_LEGEND: Array<{ label: string; tone: string }> = [
  { label: 'Direct Play', tone: TONES.DirectPlay },
  { label: 'Remux / Direct Stream', tone: TONES.Remux },
  { label: 'Transcode', tone: TONES.Transcode },
];

/** Every stream as a bar from start to stop, tinted by how it played; a click selects it. */
export function StreamLanes({ spans, selected, onSelect }: { spans: StreamSpan[]; selected: string | null; onSelect: (span: StreamSpan) => void }) {
  const { start, end, width, active, x } = useTimeline();
  const lanes = packLanes(spans, end, x, MIN_BAR);
  const count = Math.max(1, ...[...lanes.values()].map((lane) => lane + 1));

  return (
    <section aria-label="Streams im Zeitraum" className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-semibold">Streams</h3>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2">
          {LANE_LEGEND.map((entry) => (
            <li key={entry.label} className="flex items-center gap-1.5">
              <span className={clsx('size-2.5 rounded-sm', entry.tone)} aria-hidden />
              {entry.label}
            </li>
          ))}
        </ul>
      </div>
      {spans.length === 0 ? (
        <p className="mt-2 text-sm text-ink-2">Keine Streams in diesem Zeitraum.</p>
      ) : (
        <div className="relative mt-2" style={{ height: count * LANE_HEIGHT }}>
          {active !== null && <div aria-hidden className="absolute inset-y-0 w-px bg-ink-3" style={{ left: x(active) }} />}
          {spans.map((span) => {
            const key = span.id + span.start;
            const left = Math.max(0, x(span.start));
            const right = Math.min(width, Math.max(x(spanEnd(span, end)), x(span.start) + MIN_BAR));
            const first = span.phases[0]!;
            const total = Math.max(1, spanEnd(span, end) - Math.max(span.start, start));
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelect(span)}
                aria-pressed={selected === key}
                title={`${first.user} · ${first.title} (${first.client}, ${first.device})`}
                className={clsx(
                  'absolute flex h-5 overflow-hidden rounded-md bg-card-2 text-left ring-1 ring-inset transition',
                  selected === key ? 'ring-2 ring-accent' : 'ring-line hover:ring-ink-3',
                )}
                style={{ left, top: lanes.get(key)! * LANE_HEIGHT, width: Math.max(MIN_BAR, right - left) }}
              >
                {span.phases.map((phase, index) => {
                  const from = Math.max(phase.t, span.start, start);
                  const until = span.phases[index + 1]?.t ?? spanEnd(span, end);
                  return <span key={phase.t} aria-hidden className={clsx('h-full shrink-0', TONES[phase.method])} style={{ width: `${(Math.max(0, until - from) / total) * 100}%` }} />;
                })}
                <span className="absolute inset-0 flex items-center gap-1 truncate px-1.5 text-[11px] font-medium text-ink">
                  {span.phases.some((phase) => phase.method === 'Transcode') && <Cpu className="size-3 shrink-0 text-ink-2" aria-hidden />}
                  <span className="truncate">
                    {first.user} · {first.title}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
