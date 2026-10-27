import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import clsx from 'clsx';

export interface ChartSeries<T> {
  key: { [K in keyof T]: T[K] extends number | null ? K : never }[keyof T];
  label: string;
  /** Tailwind classes for the line, the marker on hover and the swatch in the tooltip. */
  stroke: string;
  fill: string;
  swatch: string;
  /** A thinner line for a reference such as a total. */
  thin?: boolean;
}

interface HistoryChartProps<T extends { t: number }> {
  points: T[];
  /** The first series is drawn on top and listed first in the tooltip. */
  series: Array<ChartSeries<T>>;
  /** Value at the top of the scale. */
  top: number;
  format: (value: number) => string;
  intervalMs: number;
  windowMs?: number;
}

const HEIGHT = 72;
const PAD = 4;

const clock = (t: number) => new Date(t).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** The last minutes of a few values on one scale; a crosshair shows all of them at a point in time. */
export function HistoryChart<T extends { t: number }>({ points, series, top, format, intervalMs, windowMs = 10 * 60_000 }: HistoryChartProps<T>) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const [active, setActive] = useState<number | null>(null);
  const point = active !== null ? points[active] : undefined;
  const value = (entry: T, key: ChartSeries<T>['key']) => entry[key] as number | null;

  const end = points.at(-1)?.t ?? Date.now();
  const start = end - windowMs;
  const x = (t: number) => ((t - start) / windowMs) * width;
  const y = (v: number) => HEIGHT - PAD - ((HEIGHT - 2 * PAD) * Math.min(v, top)) / top;

  // Gaps (nothing measured, or no value) break the line instead of bridging them.
  const path = (key: ChartSeries<T>['key']) =>
    points
      .map((entry, index) => {
        const v = value(entry, key);
        if (v === null) return '';
        const previous = points[index - 1];
        const jump = !previous || entry.t - previous.t > 3 * intervalMs || value(previous, key) === null;
        return `${jump ? 'M' : 'L'}${x(entry.t).toFixed(1)},${y(v).toFixed(1)}`;
      })
      .join('');

  function pick(event: PointerEvent<HTMLDivElement>) {
    if (!points.length || !box.current) return;
    const rect = box.current.getBoundingClientRect();
    const t = start + ((event.clientX - rect.left) / rect.width) * windowMs;
    let nearest = 0;
    points.forEach((entry, index) => {
      if (Math.abs(entry.t - t) < Math.abs(points[nearest]!.t - t)) nearest = index;
    });
    setActive(nearest);
  }

  function step(event: KeyboardEvent<HTMLDivElement>) {
    if (!points.length) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const from = active ?? points.length - 1;
      setActive(Math.min(points.length - 1, Math.max(0, from + (event.key === 'ArrowLeft' ? -1 : 1))));
    }
    if (event.key === 'Escape') setActive(null);
  }

  const latest = points.at(-1);
  const minutes = Math.round(windowMs / 60_000);
  const summary = latest
    ? `Verlauf der letzten ${minutes} Minuten, Skala bis ${format(top)}. Zuletzt ${series
        .map((entry) => `${entry.label} ${value(latest, entry.key) === null ? 'unbekannt' : format(value(latest, entry.key)!)}`)
        .join(', ')}.`
    : 'Noch kein Verlauf.';

  return (
    <div className="mt-3">
      <div className="flex justify-between text-[11px] text-ink-3">
        <span>{format(top)}</span>
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
            {[...series].reverse().map((entry) => (
              <path key={String(entry.key)} d={path(entry.key)} fill="none" className={entry.stroke} strokeWidth={entry.thin ? 1.5 : 2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {point && (
              <g>
                <line x1={x(point.t)} x2={x(point.t)} y1={0} y2={HEIGHT - PAD} className="stroke-ink-3" strokeWidth={1} />
                {[...series].reverse().map((entry) => {
                  const v = value(point, entry.key);
                  return v === null ? null : <circle key={String(entry.key)} cx={x(point.t)} cy={y(v)} r={4} className={clsx(entry.fill, 'stroke-card')} strokeWidth={2} />;
                })}
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
            {series.map((entry) => {
              const v = value(point, entry.key);
              return (
                <p key={String(entry.key)} className="flex items-center gap-1.5">
                  <span className={clsx('size-2 rounded-full', entry.swatch)} aria-hidden />
                  <b className="tabular-nums">{v === null ? '–' : format(v)}</b> <span className="text-ink-2">{entry.label}</span>
                </p>
              );
            })}
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-ink-3">
        <span>vor {minutes} min</span>
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
