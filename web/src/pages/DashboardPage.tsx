import { useEffect } from 'react';
import { Activity, CircleCheck, Cpu, Gauge, MonitorPlay, RefreshCw, Shuffle, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import type { SessionsResponse } from '@manelly/shared';
import { ErrorPanel } from '../components/ErrorPanel';
import { StatTile } from '../components/StatTile';
import { StreamCard } from '../components/StreamCard';
import { SESSIONS_REFRESH_MS, useSessions } from '../hooks/queries';
import { useNow } from '../hooks/useNow';
import { formatAgo, formatBitrate } from '../lib/format';

export function DashboardPage() {
  const { data, error, isPending, isFetching, dataUpdatedAt, refetch } = useSessions();

  useEffect(() => {
    const count = data?.summary.total ?? 0;
    document.title = data ? `${count} ${count === 1 ? 'Stream' : 'Streams'} · Manelly` : 'Manelly';
  }, [data]);

  return (
    <div className="mx-auto max-w-7xl">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Laufende Streams</h1>
          <p className="mt-1 text-sm text-ink-2">
            Live-Übersicht deines Jellyfin-Servers · aktualisiert alle {SESSIONS_REFRESH_MS / 1000} s
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-ink-2">
          {dataUpdatedAt > 0 && <UpdatedAgo timestamp={dataUpdatedAt} />}
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-2 rounded-lg bg-card px-3 py-2 font-medium text-ink shadow-sm ring-1 ring-line transition hover:bg-card-2 disabled:cursor-wait"
          >
            <RefreshCw className={clsx('size-4', isFetching && 'animate-spin')} aria-hidden />
            Aktualisieren
          </button>
        </div>
      </header>

      <div className="mt-6 space-y-6">
        {isPending ? (
          <LoadingState />
        ) : !data ? (
          <ErrorPanel error={error} />
        ) : (
          <>
            {error && <StaleBanner error={error} />}
            <Summary data={data} />
            <StreamList data={data} sampledAt={dataUpdatedAt} />
          </>
        )}
      </div>
    </div>
  );
}

function UpdatedAgo({ timestamp }: { timestamp: number }) {
  const now = useNow(1000);
  return <span className="hidden tabular-nums sm:inline">Stand: {formatAgo(timestamp, now)}</span>;
}

function Summary({ data }: { data: SessionsResponse }) {
  const { summary, idleSessions } = data;
  const softwareTranscodes = summary.transcode - summary.hardwareTranscodes;

  return (
    <section aria-labelledby="summary-heading">
      <h2 id="summary-heading" className="sr-only">
        Übersicht
      </h2>
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label="Aktive Streams"
          value={String(summary.total)}
          caption={idleSessions > 0 ? `${idleSessions} weitere ${idleSessions === 1 ? 'Gerät' : 'Geräte'} verbunden` : 'Keine weiteren Geräte verbunden'}
          icon={Activity}
          tone="bg-accent/12 text-accent"
          className="col-span-2 md:col-span-1"
        />
        <StatTile label="Direct Play" value={String(summary.directPlay)} caption="Ohne Last für den Server" icon={CircleCheck} tone="bg-good/12 text-good" />
        <StatTile
          label="Direct Stream"
          value={String(summary.directStream)}
          caption="Inkl. Remux · Video unverändert"
          icon={Shuffle}
          tone="bg-info/12 text-info"
        />
        <StatTile
          label="Transcodes"
          value={String(summary.transcode)}
          caption={
            summary.transcode === 0
              ? 'Kein Video wird neu codiert'
              : softwareTranscodes > 0
                ? `${softwareTranscodes} ohne Hardware-Beschleunigung`
                : 'Alle hardwarebeschleunigt'
          }
          icon={Cpu}
          tone="bg-warning/15 text-warning"
        />
        <StatTile
          label="Bandbreite"
          value={summary.estimatedBandwidth > 0 ? formatBitrate(summary.estimatedBandwidth) : '–'}
          caption="Geschätzt über alle Streams"
          icon={Gauge}
          tone="bg-accent/12 text-accent"
        />
      </dl>
    </section>
  );
}

function StreamList({ data, sampledAt }: { data: SessionsResponse; sampledAt: number }) {
  if (data.sessions.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-line px-6 py-16 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-card text-ink-2 ring-1 ring-line">
          <MonitorPlay className="size-6" aria-hidden />
        </span>
        <h2 className="mt-4 text-lg font-semibold">Gerade läuft nichts</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-ink-2">
          Sobald jemand auf deinem Jellyfin-Server etwas abspielt, erscheint der Stream hier automatisch.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="streams-heading">
      <h2 id="streams-heading" className="sr-only">
        Streams
      </h2>
      <div className="grid gap-4 xl:grid-cols-2">
        {data.sessions.map((session) => (
          <StreamCard key={session.id} session={session} sampledAt={sampledAt} />
        ))}
      </div>
    </section>
  );
}

function StaleBanner({ error }: { error: Error }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-xl bg-warning/12 px-4 py-3 text-sm ring-1 ring-warning/30 ring-inset">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <p>
        <span className="font-medium">Aktualisierung fehlgeschlagen – angezeigt wird der letzte bekannte Stand.</span>{' '}
        <span className="text-ink-2">{error.message}</span>
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div aria-busy className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="h-[7.25rem] animate-pulse rounded-2xl border border-line bg-card" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="h-64 animate-pulse rounded-2xl border border-line bg-card" />
        ))}
      </div>
    </div>
  );
}
