import { useEffect, useId, useState } from 'react';
import { Activity, CircleCheck, Cpu, Gauge, MonitorPlay, RefreshCw, Shuffle, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import type { SessionsResponse } from '@manelly/shared';
import { BandwidthPanel } from '../components/BandwidthPanel';
import { DashboardConversions } from '../components/DashboardConversions';
import { ErrorPanel } from '../components/ErrorPanel';
import { SetupPanel } from '../components/SetupPanel';
import { StatTile } from '../components/StatTile';
import { StreamCard } from '../components/StreamCard';
import { isConfigured, SESSIONS_REFRESH_MS, useAgentNetwork, useAgentSettings, useSessions, useSettings } from '../hooks/queries';
import { useNow } from '../hooks/useNow';
import { useStickyError } from '../hooks/useStickyError';
import { formatAgo, formatBitrate, joinParts } from '../lib/format';

export function DashboardPage() {
  const settings = useSettings();
  const configured = settings.data ? isConfigured(settings.data) : undefined;
  // No polling while the setup form is shown, so typing there is never interrupted.
  const sessions = useSessions(configured === true);
  const { data, error, isFetching, dataUpdatedAt, refetch } = sessions;
  const settingsError = useStickyError(settings.error, settings.data !== undefined);
  const sessionsError = useStickyError(error, data !== undefined);

  useEffect(() => {
    const count = data?.summary.total ?? 0;
    document.title = data ? `${count} ${count === 1 ? 'Stream' : 'Streams'} · Manelly` : 'Manelly';
  }, [data]);

  function content() {
    if (configured === undefined) {
      return settingsError ? <ErrorPanel error={settingsError} /> : <LoadingState />;
    }
    if (!configured) return <SetupPanel />;
    if (data) {
      return (
        <>
          {error && <StaleBanner error={error} />}
          <Summary data={data} />
          <DashboardConversions />
          <StreamList data={data} sampledAt={dataUpdatedAt} />
        </>
      );
    }
    return sessionsError ? <ErrorPanel error={sessionsError} /> : <LoadingState />;
  }

  return (
    <div className="mx-auto max-w-7xl">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Laufende Streams</h1>
          <p className="mt-1 text-sm text-ink-2">
            Live-Übersicht deines Jellyfin-Servers · aktualisiert alle {SESSIONS_REFRESH_MS / 1000} s
          </p>
        </div>
        {configured && (
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
        )}
      </header>

      <div className="mt-6 space-y-6">{content()}</div>
    </div>
  );
}

function UpdatedAgo({ timestamp }: { timestamp: number }) {
  const now = useNow(1000);
  return <span className="hidden tabular-nums sm:inline">Stand: {formatAgo(timestamp, now)}</span>;
}

/** "rolf (2), Anna" – who is streaming right now, in the order of the stream cards. */
function streamingUsers(data: SessionsResponse): string | null {
  const counts = new Map<string, number>();
  for (const session of data.sessions) counts.set(session.user.name, (counts.get(session.user.name) ?? 0) + 1);
  if (counts.size === 0) return null;
  return [...counts].map(([name, count]) => (count > 1 ? `${name} (${count})` : name)).join(', ');
}

function Summary({ data }: { data: SessionsResponse }) {
  const { summary, idleSessions } = data;
  const softwareTranscodes = summary.transcode - summary.hardwareTranscodes;
  const idle = idleSessions > 0 ? `${idleSessions} weitere ${idleSessions === 1 ? 'Gerät' : 'Geräte'} verbunden` : null;
  const viewers = streamingUsers(data);
  const panelId = useId();
  const [bandwidthOpen, setBandwidthOpen] = useState(false);
  const agentSettings = useAgentSettings();
  const agentConfigured = Boolean(agentSettings.data?.url && agentSettings.data.hasToken);
  // Also while closed: the agent keeps measuring, so the chart already shows the last minutes when it opens.
  const network = useAgentNetwork(agentConfigured);

  return (
    <section aria-labelledby="summary-heading">
      <h2 id="summary-heading" className="sr-only">
        Übersicht
      </h2>
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label="Aktive Streams"
          value={String(summary.total)}
          caption={viewers ? joinParts([viewers, idle]) : (idle ?? 'Keine weiteren Geräte verbunden')}
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
              : summary.struggling > 0
                ? `${summary.struggling} ${summary.struggling === 1 ? 'kommt' : 'kommen'} nicht nach – siehe Diagnose`
                : softwareTranscodes > 0
                  ? `${softwareTranscodes} ohne Hardware-Beschleunigung`
                  : 'Hardware-Beschleunigung eingerichtet'
          }
          icon={Cpu}
          tone={summary.struggling > 0 ? 'bg-critical/12 text-critical' : 'bg-warning/15 text-warning'}
        />
        <StatTile
          label="Bandbreite"
          value={summary.estimatedBandwidth > 0 ? formatBitrate(summary.estimatedBandwidth) : '–'}
          caption="Geschätzt über alle Streams"
          icon={Gauge}
          tone="bg-accent/12 text-accent"
          toggle={{
            expanded: bandwidthOpen,
            controls: panelId,
            label: bandwidthOpen ? 'Bandbreite: Details ausblenden' : 'Bandbreite: Bitrate der Streams und Netzwerk des Servers zeigen',
            onToggle: () => setBandwidthOpen((open) => !open),
          }}
        />
      </dl>
      {bandwidthOpen && <BandwidthPanel id={panelId} sessions={data.sessions} network={network.data} agentConfigured={agentConfigured} />}
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
