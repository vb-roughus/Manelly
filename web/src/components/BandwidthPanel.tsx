import type { AgentNetworkStatus, StreamSession } from '@manelly/shared';
import { Network, Radio } from 'lucide-react';
import { formatBitrate, itemHeadline, joinParts } from '../lib/format';
import { NetworkInterfaces } from './NetworkInterfaces';
import { PLAY_METHODS } from './PlayMethodBadge';

interface BandwidthPanelProps {
  id: string;
  sessions: StreamSession[];
  network: AgentNetworkStatus | undefined;
  agentConfigured: boolean;
}

/** Behind the bandwidth tile: what each stream needs right now, then how busy the server's network interfaces are. */
export function BandwidthPanel({ id, sessions, network, agentConfigured }: BandwidthPanelProps) {
  return (
    <div id={id} className="mt-3 rounded-2xl border border-line bg-card p-4 shadow-sm shadow-black/5 sm:p-5">
      <StreamRates sessions={sessions} />
      <section aria-labelledby={`${id}-network`} className="mt-5 border-t border-line pt-4">
        <h3 id={`${id}-network`} className="mb-3 flex items-center gap-2 font-semibold">
          <Network className="size-4 text-accent" aria-hidden />
          Netzwerk des Servers
        </h3>
        <NetworkInterfaces data={network} agentConfigured={agentConfigured} />
      </section>
    </div>
  );
}

function StreamRates({ sessions }: { sessions: StreamSession[] }) {
  const streams = sessions.filter((session) => session.estimatedBitrate).sort((a, b) => (b.estimatedBitrate ?? 0) - (a.estimatedBitrate ?? 0));
  const total = streams.reduce((sum, session) => sum + (session.estimatedBitrate ?? 0), 0);
  // Remote streams go through the internet upload, usually the narrower pipe.
  const remote = streams.filter((session) => session.isLocalNetwork === false).reduce((sum, session) => sum + (session.estimatedBitrate ?? 0), 0);
  const top = streams[0]?.estimatedBitrate ?? 0;

  return (
    <section aria-label="Bitrate der Streams">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="flex items-center gap-2 font-semibold">
          <Radio className="size-4 text-accent" aria-hidden />
          Streams
        </h3>
        {total > 0 && (
          <p className="text-sm text-ink-2">
            <b className="text-ink tabular-nums">{formatBitrate(total)}</b> gesamt
            {remote > 0 && (
              <>
                {' · '}
                <b className="text-ink tabular-nums">{formatBitrate(remote)}</b> nach extern
              </>
            )}
          </p>
        )}
      </div>
      {streams.length === 0 ? (
        <p className="text-sm text-ink-2">{sessions.length ? 'Für die laufenden Streams ist keine Bitrate bekannt.' : 'Gerade läuft kein Stream.'}</p>
      ) : (
        <ul className="space-y-3">
          {streams.map((session) => (
            <StreamRate key={session.id} session={session} share={top ? (session.estimatedBitrate ?? 0) / top : 0} />
          ))}
        </ul>
      )}
    </section>
  );
}

function StreamRate({ session, share }: { session: StreamSession; share: number }) {
  const { title, subtitle } = itemHeadline(session.item);
  const fromTranscoder = Boolean(session.transcoding?.bitrate);
  const where = session.isLocalNetwork === null ? null : session.isLocalNetwork ? 'Lokal' : 'Extern';
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <p className="min-w-0 truncate">
          <span className="font-medium">{session.user.name}</span>
          <span className="text-ink-2"> · {joinParts([title, subtitle])}</span>
        </p>
        <p className="shrink-0 tabular-nums">
          <b>{formatBitrate(session.estimatedBitrate ?? 0)}</b>
        </p>
      </div>
      <p className="truncate text-xs text-ink-3">
        {joinParts([`${session.device} · ${session.client}`, PLAY_METHODS[session.playback.method].label, where, fromTranscoder ? 'laut Transcoder' : 'Bitrate der Datei'])}
      </p>
      {/* One hue: every bar is data the server sends; the longest stream fills the row. */}
      <div className="mt-1.5 h-1.5 rounded-full bg-card-2" aria-hidden>
        <div className="h-full rounded-full bg-series-send" style={{ width: `${Math.max(share * 100, 1)}%` }} />
      </div>
    </li>
  );
}
