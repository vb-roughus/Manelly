import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { HistoryPoint, HistoryResponse, StreamEvent, StreamSpan } from '@manelly/shared';
import { ChevronLeft, ChevronRight, Cpu, MonitorCog, Network, Play, Square, Trash2, TriangleAlert, Tv } from 'lucide-react';
import clsx from 'clsx';
import type { ChartSeries } from '../components/HistoryChart';
import { PlayMethodBadge } from '../components/PlayMethodBadge';
import { StreamLanes, TimeAxis, Timeline, TimelineChart } from '../components/Timeline';
import { useAgent, useClearHistory, useHistory, useSaveHistorySettings } from '../hooks/queries';
import { formatBitrate, formatBytes } from '../lib/format';
import { describeMedia, describeTranscoding, formatMoment, formatRange, formatSpan, niceCeil, spanEnd } from '../lib/timeline';
import { describeTranscodeReason } from '../lib/transcodeReasons';

const HOUR = 3_600_000;
const PRESETS = [
  { span: HOUR, label: '1 h' },
  { span: 6 * HOUR, label: '6 h' },
  { span: 24 * HOUR, label: '24 h' },
  { span: 7 * 24 * HOUR, label: '7 Tage' },
  { span: 30 * 24 * HOUR, label: '30 Tage' },
];
const RETENTION = [7, 30, 90, 365];

const button =
  'inline-flex items-center gap-1.5 rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-ink ring-1 ring-line transition hover:bg-card-2 disabled:cursor-not-allowed disabled:opacity-50';

export function TroubleshootingPage() {
  useEffect(() => {
    document.title = 'Troubleshooting · Manelly';
  }, []);
  const agent = useAgent();
  const status = agent.data?.status;
  const supported = Boolean(status?.history);

  // The range lives in the address, so the back button and a shared link show the same.
  const [params, setParams] = useSearchParams();
  const span = Number(params.get('span')) || 6 * HOUR;
  const end = params.get('end') ? Number(params.get('end')) : null;
  const setRange = (nextSpan: number, nextEnd: number | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('span', String(Math.round(nextSpan)));
        if (nextEnd === null || nextEnd >= Date.now()) next.delete('end');
        else next.set('end', String(Math.round(nextEnd)));
        return next;
      },
      { replace: true },
    );

  const history = useHistory(span, end, supported);
  const recorded = history.data && (history.data.settings.enabled || history.data.bytes > 0);

  return (
    <div className="mx-auto max-w-7xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Troubleshooting</h1>
        <p className="mt-1 text-sm text-ink-2">
          Was lief auf dem Server, als es ruckelte? Der Agent zeichnet Auslastung und Streams auf – hier schaust du zurück.
        </p>
      </header>

      <div className="mt-6 space-y-4">
        {agent.isPending && <div aria-busy className="h-24 animate-pulse rounded-2xl bg-card-2" />}
        {agent.data && !agent.data.configured && (
          <Card>
            <p className="font-medium">Noch kein Agent eingerichtet</p>
            <p className="mt-1 text-sm text-ink-2">
              Die Aufzeichnung macht der Manelly-Agent auf dem Jellyfin-Server. Adresse und Schlüssel trägst du unter{' '}
              <Link to="/settings" className="font-medium text-accent hover:underline">
                Einstellungen
              </Link>{' '}
              ein.
            </p>
          </Card>
        )}
        {agent.data?.error && <Card tone="critical">{agent.data.error}</Card>}
        {status && !supported && (
          <Card tone="critical">
            Der Agent auf {status.hostname} ist zu alt für die Aufzeichnung (Version {status.version}). Auf dem Jellyfin-Server <code>git pull</code> und{' '}
            <code>scripts\start-agent.cmd -Install</code> ausführen.
          </Card>
        )}
        {history.error && !history.data && <Card tone="critical">{history.error.message}</Card>}
        {supported && !history.data && !history.error && <div aria-busy className="h-24 animate-pulse rounded-2xl bg-card-2" />}

        {history.data && <RecordingPanel history={history.data} />}

        {recorded && history.data && (
          <>
            <RangeBar span={span} end={end} history={history.data} onChange={setRange} />
            <HistoryView history={history.data} fetching={history.isPlaceholderData} onZoom={setRange} />
          </>
        )}
      </div>
    </div>
  );
}

function Card({ tone, children }: { tone?: 'critical'; children: ReactNode }) {
  return (
    <div className={clsx('rounded-2xl border p-4 text-sm shadow-sm shadow-black/5', tone === 'critical' ? 'border-critical/30 bg-critical/8' : 'border-line bg-card')}>
      {children}
    </div>
  );
}

/** Whether the agent records, how long it keeps the records, and how much space they take. */
function RecordingPanel({ history }: { history: HistoryResponse }) {
  const id = useId();
  const save = useSaveHistorySettings();
  const clear = useClearHistory();
  const [confirming, setConfirming] = useState(false);
  const { enabled, retentionDays } = history.settings;
  const setEnabled = (next: boolean) => save.mutate({ enabled: next, retentionDays });

  const retention = (
    <label htmlFor={`${id}-retention`} className="flex items-center gap-2 text-sm text-ink-2">
      Aufbewahren
      <select
        id={`${id}-retention`}
        value={retentionDays}
        disabled={save.isPending}
        onChange={(event) => save.mutate({ enabled, retentionDays: Number(event.target.value) })}
        className="rounded-lg border border-line bg-card px-2 py-1 text-sm text-ink outline-none focus:border-accent focus:ring-3 focus:ring-accent/20"
      >
        {[...new Set([...RETENTION, retentionDays])]
          .sort((a, b) => a - b)
          .map((days) => (
            <option key={days} value={days}>
              {days === 365 ? '1 Jahr' : `${days} Tage`}
            </option>
          ))}
      </select>
    </label>
  );

  if (!enabled && history.bytes === 0) {
    return (
      <Card>
        <p className="font-medium">Aufzeichnung ist aus</p>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          Eingeschaltet hält der Agent rund um die Uhr alle 15 Sekunden fest, wie stark CPU, GPU und die gewählten Netzwerkschnittstellen ausgelastet sind –
          und jeden Stream: wer mit welchem Client was abspielt, und warum Jellyfin umwandelt. Läuft der Agent nicht, bleibt eine Lücke. Ein Tag braucht
          etwa 1 MB.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => setEnabled(true)}
            disabled={save.isPending}
            className="bg-brand inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-50"
          >
            <Play className="size-4" aria-hidden /> Aufzeichnung starten
          </button>
          {retention}
        </div>
        {save.isError && <p className="mt-3 text-sm text-critical">{save.error.message}</p>}
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <p className="flex items-center gap-2 font-medium">
          <span className={clsx('size-2.5 rounded-full', enabled ? 'animate-pulse bg-good' : 'bg-ink-3')} aria-hidden />
          {enabled ? 'Zeichnet auf' : 'Aufzeichnung angehalten'}
        </p>
        <p className="text-sm text-ink-2">
          {formatBytes(history.bytes)}
          {history.oldest !== null && <> · seit {new Date(history.oldest).toLocaleDateString('de-CH')}</>}
        </p>
        {retention}
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <button type="button" className={button} disabled={save.isPending} onClick={() => setEnabled(!enabled)}>
            {enabled ? <Square className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
            {enabled ? 'Anhalten' : 'Fortsetzen'}
          </button>
          {confirming ? (
            <span className="flex items-center gap-2 text-sm">
              Alle Aufzeichnungen löschen?
              <button
                type="button"
                className={clsx(button, 'text-critical')}
                disabled={clear.isPending}
                onClick={() => clear.mutate(undefined, { onSettled: () => setConfirming(false) })}
              >
                Löschen
              </button>
              <button type="button" className="text-ink-2 hover:text-ink" onClick={() => setConfirming(false)}>
                Abbrechen
              </button>
            </span>
          ) : (
            <button type="button" className={button} disabled={history.bytes === 0} onClick={() => setConfirming(true)}>
              <Trash2 className="size-4" aria-hidden /> Daten löschen
            </button>
          )}
        </div>
      </div>
      {history.error && (
        <p className="mt-3 flex items-start gap-2 text-sm text-ink-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          {history.error}
        </p>
      )}
      {(save.isError || clear.isError) && <p className="mt-3 text-sm text-critical">{(save.error ?? clear.error)!.message}</p>}
    </Card>
  );
}

const toLocalInput = (t: number) => {
  const date = new Date(t - new Date(t).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
};

/** The range for everything below: its length, and where it ends. */
function RangeBar({ span, end, history, onChange }: { span: number; end: number | null; history: HistoryResponse; onChange: (span: number, end: number | null) => void }) {
  const id = useId();
  const to = end ?? history.to;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <div role="group" aria-label="Zeitraum" className="flex rounded-lg bg-card-2 p-0.5">
        {PRESETS.map((preset) => (
          <button
            key={preset.span}
            type="button"
            aria-pressed={preset.span === span}
            onClick={() => onChange(preset.span, end)}
            className={clsx('rounded-md px-3 py-1 text-sm font-medium transition', preset.span === span ? 'bg-card text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Früher" title="Früher" className={clsx(button, 'px-2')} onClick={() => onChange(span, to - span)}>
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <button type="button" aria-label="Später" title="Später" className={clsx(button, 'px-2')} disabled={end === null} onClick={() => onChange(span, to + span)}>
          <ChevronRight className="size-4" aria-hidden />
        </button>
        <button type="button" className={button} disabled={end === null} onClick={() => onChange(span, null)}>
          Jetzt
        </button>
      </div>
      <label htmlFor={`${id}-end`} className="flex items-center gap-2 text-sm text-ink-2">
        Bis
        <input
          id={`${id}-end`}
          type="datetime-local"
          value={toLocalInput(to)}
          max={toLocalInput(Date.now())}
          onChange={(event) => {
            const t = new Date(event.target.value).getTime();
            if (Number.isFinite(t)) onChange(span, t);
          }}
          className="rounded-lg border border-line bg-card px-2 py-1 text-sm text-ink outline-none focus:border-accent focus:ring-3 focus:ring-accent/20"
        />
      </label>
      <p className="text-sm text-ink-2 sm:ml-auto">
        {formatRange(history.from, history.to)}
        {end === null && ' · laufend'}
      </p>
    </div>
  );
}

const percent = (value: number) => (value > 0 && value < 1 ? '< 1 %' : `${Math.round(value)} %`);
const count = (value: number) => String(Math.round(value));
const keyOf = (span: StreamSpan) => span.id + span.start;

const LOAD_SERIES = {
  cpu: [
    { key: 'cpuJellyfin', label: 'Jellyfin (FFmpeg)', stroke: 'stroke-series-jellyfin', fill: 'fill-series-jellyfin', swatch: 'bg-series-jellyfin' },
    { key: 'cpuConversion', label: 'Umwandlung', stroke: 'stroke-series-conversion', fill: 'fill-series-conversion', swatch: 'bg-series-conversion' },
    { key: 'cpu', label: 'Gesamt', stroke: 'stroke-ink-3', fill: 'fill-ink-3', swatch: 'bg-ink-3', thin: true },
  ],
  gpu: [
    { key: 'gpuJellyfin', label: 'Jellyfin (FFmpeg)', stroke: 'stroke-series-jellyfin', fill: 'fill-series-jellyfin', swatch: 'bg-series-jellyfin' },
    { key: 'gpuConversion', label: 'Umwandlung', stroke: 'stroke-series-conversion', fill: 'fill-series-conversion', swatch: 'bg-series-conversion' },
    { key: 'gpu', label: 'Gesamt', stroke: 'stroke-ink-3', fill: 'fill-ink-3', swatch: 'bg-ink-3', thin: true },
  ],
} satisfies Record<string, Array<ChartSeries<HistoryPoint>>>;

const STREAM_SERIES: Array<ChartSeries<HistoryPoint>> = [
  { key: 'transcodes', label: 'Transcodes', stroke: 'stroke-series-jellyfin', fill: 'fill-series-jellyfin', swatch: 'bg-series-jellyfin' },
  { key: 'streams', label: 'Streams', stroke: 'stroke-ink-3', fill: 'fill-ink-3', swatch: 'bg-ink-3', thin: true },
];

interface RatePoint {
  t: number;
  tx: number | null;
  rx: number | null;
}

const RATE_SERIES: Array<ChartSeries<RatePoint>> = [
  { key: 'tx', label: 'Senden', stroke: 'stroke-series-send', fill: 'fill-series-send', swatch: 'bg-series-send' },
  { key: 'rx', label: 'Empfangen', stroke: 'stroke-series-receive', fill: 'fill-series-receive', swatch: 'bg-series-receive' },
];

/** Average and peak over the range, for the header of a chart. */
function Summary({ label, values, peaks, format }: { label?: string; values: Array<number | null>; peaks?: Array<number | null>; format: (value: number) => string }) {
  const known = values.filter((value): value is number => value !== null);
  if (!known.length) return <span className="text-ink-3">nichts aufgezeichnet</span>;
  const peak = Math.max(...(peaks ?? values).filter((value): value is number => value !== null));
  return (
    <span>
      {label && `${label} `}Ø <b className="font-semibold text-ink tabular-nums">{format(known.reduce((sum, value) => sum + value, 0) / known.length)}</b> · Spitze{' '}
      <b className="font-semibold text-ink tabular-nums">{format(peak)}</b>
    </span>
  );
}

function HistoryView({ history, fetching, onZoom }: { history: HistoryResponse; fetching: boolean; onZoom: (span: number, end: number | null) => void }) {
  const [active, setActive] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const { points, streams } = history;
  const selectedSpan = streams.find((span) => keyOf(span) === selected) ?? null;

  const markers = streams.flatMap((span) => span.phases.filter((phase) => phase.type !== 'stop').map((phase) => ({ t: phase.t, transcode: phase.method === 'Transcode' })));
  const hasGpu = points.some((point) => point.gpu !== null);
  const peakStreams = Math.max(0, ...points.map((point) => point.streams ?? 0));

  /** A click on a selected stream lets go of it; zooming to it keeps it selected. */
  function select(span: StreamSpan, toggle = true) {
    const key = keyOf(span);
    setSelected(toggle && selected === key ? null : key);
    if (selected !== key) document.getElementById(`stream-${key}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  return (
    <>
      <div className={clsx('rounded-2xl border border-line bg-card px-4 py-1 shadow-sm shadow-black/5 transition-opacity', fetching && 'opacity-60')}>
        <Timeline start={history.from} end={history.to} step={history.step} active={active} setActive={setActive} markers={markers} highlight={selectedSpan && { start: selectedSpan.start, end: spanEnd(selectedSpan, history.to) }}>
          <TimeAxis />
          <StreamLanes spans={streams} selected={selected} onSelect={select} />
          {points.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-2">In diesem Zeitraum wurde nichts aufgezeichnet – der Agent lief nicht, oder die Aufzeichnung war aus.</p>
          ) : (
            <>
              <TimelineChart
                title="Gleichzeitige Streams"
                icon={Tv}
                points={points}
                series={STREAM_SERIES}
                top={Math.max(2, niceCeil(peakStreams))}
                format={count}
                height={64}
                summary={
                  points.some((point) => point.streams !== null) ? (
                    <span>
                      höchstens <b className="font-semibold text-ink tabular-nums">{peakStreams}</b> gleichzeitig · {streams.length} Streams im Zeitraum
                    </span>
                  ) : (
                    <span className="text-ink-3">ohne Jellyfin-Verbindung nicht aufgezeichnet</span>
                  )
                }
                extra={(point) => (point.bitrate ? `zusammen etwa ${formatBitrate(point.bitrate)}` : null)}
              />
              <TimelineChart
                title="CPU"
                icon={Cpu}
                points={points}
                series={LOAD_SERIES.cpu}
                band={{ low: 'cpu', high: 'cpuMax' }}
                top={100}
                format={percent}
                summary={<Summary values={points.map((point) => point.cpu)} peaks={points.map((point) => point.cpuMax)} format={percent} />}
              />
              {hasGpu && (
                <TimelineChart
                  title="GPU – die am stärksten ausgelastete Einheit"
                  icon={MonitorCog}
                  points={points}
                  series={LOAD_SERIES.gpu}
                  band={{ low: 'gpu', high: 'gpuMax' }}
                  top={100}
                  format={percent}
                  summary={<Summary values={points.map((point) => point.gpu)} peaks={points.map((point) => point.gpuMax)} format={percent} />}
                />
              )}
              {history.interfaces.map((nic) => {
                const rates: RatePoint[] = points.map((point) => ({ t: point.t, tx: point.network[nic.id]?.tx ?? null, rx: point.network[nic.id]?.rx ?? null }));
                const peak = Math.max(0, ...rates.flatMap((rate) => [rate.tx ?? 0, rate.rx ?? 0]));
                return (
                  <TimelineChart
                    key={nic.id}
                    title={nic.name}
                    icon={Network}
                    points={rates}
                    series={RATE_SERIES}
                    top={niceCeil(Math.max(peak, 1_000_000))}
                    format={formatBitrate}
                    summary={
                      <>
                        <Summary label="Senden" values={rates.map((rate) => rate.tx)} format={formatBitrate} />
                        <Summary label="Empfangen" values={rates.map((rate) => rate.rx)} format={formatBitrate} />
                      </>
                    }
                  />
                );
              })}
            </>
          )}
          <TimeAxis />
        </Timeline>
      </div>
      {points.length > 0 && (
        <p className="text-xs text-ink-3">
          Ein Punkt fasst {formatSpan(history.step)} zusammen; bei langen Zeiträumen zeigt die graue Fläche die Spitze darin. Gestrichelte Linien markieren den Start
          oder Wechsel eines Streams, gelb bei einem Transcode.
        </p>
      )}

      <StreamList spans={streams} to={history.to} selected={selected} onSelect={select} onZoom={onZoom} />
    </>
  );
}

/** Every stream of the range with who, what, how, and why; newest first. */
function StreamList({
  spans,
  to,
  selected,
  onSelect,
  onZoom,
}: {
  spans: StreamSpan[];
  to: number;
  selected: string | null;
  onSelect: (span: StreamSpan, toggle?: boolean) => void;
  onZoom: (span: number, end: number | null) => void;
}) {
  if (spans.length === 0) return null;
  return (
    <section aria-labelledby="streams-heading">
      <h2 id="streams-heading" className="mb-3 text-lg font-semibold">
        Streams im Zeitraum <span className="text-sm font-normal text-ink-2">· {spans.length}</span>
      </h2>
      <ul className="space-y-2">
        {[...spans]
          .sort((a, b) => b.start - a.start)
          .map((span) => {
            const key = keyOf(span);
            const first = span.phases[0]!;
            const until = spanEnd(span, to);
            return (
              <li
                key={key}
                id={`stream-${key}`}
                className={clsx('rounded-xl border bg-card p-3 shadow-sm shadow-black/5 transition', selected === key ? 'border-accent ring-2 ring-accent/30' : 'border-line')}
              >
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <button type="button" onClick={() => onSelect(span)} aria-pressed={selected === key} className="min-w-0 text-left">
                    <p className="text-xs text-ink-2">
                      {formatMoment(span.start)} ·{' '}
                      {span.ongoing ? `läuft seit ${formatSpan(to - span.start)}` : span.end !== null ? formatSpan(span.end - span.start) : 'Ende unbekannt (Agent war aus)'}
                    </p>
                    <p className="truncate font-semibold">{first.title}</p>
                    <p className="text-sm text-ink-2">
                      <b className="font-medium text-ink">{first.user}</b> · {first.client} · {first.device}
                      {first.remoteAddress && <> · {first.remoteAddress}</>}
                    </p>
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="text-xs font-medium text-accent hover:underline"
                      onClick={() => {
                        const length = Math.max(15 * 60_000, (until - span.start) * 1.4);
                        onSelect(span, false);
                        onZoom(length, until + (length - (until - span.start)) / 2);
                      }}
                    >
                      Ausschnitt zeigen
                    </button>
                  </div>
                </div>
                <ol className="mt-2 space-y-1.5">
                  {span.phases.map((phase, index) => (
                    <Phase key={phase.t} phase={phase} change={index > 0} />
                  ))}
                </ol>
              </li>
            );
          })}
      </ul>
    </section>
  );
}

function Phase({ phase, change }: { phase: StreamEvent; change: boolean }) {
  const target = describeTranscoding(phase);
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {change && <span className="text-xs text-ink-3">ab {new Date(phase.t).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}</span>}
      <PlayMethodBadge method={phase.method} hardware={phase.transcoding?.hardware} />
      <span className="text-ink-2">
        {describeMedia(phase.source)}
        {target && <> → {target}</>}
      </span>
      {phase.reasons.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {phase.reasons.map((reason) => {
            const text = describeTranscodeReason(reason);
            return (
              <span key={reason} title={text.hint} className="rounded-full bg-warning/12 px-2 py-0.5 text-xs text-ink ring-1 ring-warning/30 ring-inset">
                {text.label}
              </span>
            );
          })}
        </span>
      )}
      {phase.method === 'Transcode' && phase.reasons.length === 0 && <span className="text-xs text-ink-3">Grund nicht gemeldet</span>}
    </li>
  );
}
