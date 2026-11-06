import { useState } from 'react';
import { Link } from 'react-router';
import type { StreamSession } from '@manelly/shared';
import { MonitorPlay, Pause, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import { isConfigured, useSessions, useSettings } from '../hooks/queries';
import { formatBitrate, itemHeadline, joinParts } from '../lib/format';
import { CountBadge, HeaderMenu } from './HeaderMenu';
import { PLAY_METHODS } from './PlayMethodBadge';

/**
 * Left of the bell: how many stream right now, from every page, and a short overview of them; the details stay on the
 * dashboard. Shares its query with the dashboard, so it adds no second poll there.
 */
export function StreamsMenu() {
  const { data: settings } = useSettings();
  const configured = settings ? isConfigured(settings) : false;
  const sessions = useSessions(configured);
  const [open, setOpen] = useState(false);
  if (!configured) return null;

  const streams = sessions.data?.sessions ?? [];
  const label = streams.length === 0 ? 'Streams – niemand streamt' : `Streams – ${streams.length} aktiv`;

  return (
    <HeaderMenu
      icon={MonitorPlay}
      label={label}
      badge={<CountBadge count={streams.length} />}
      heading={streams.length === 1 ? '1 Stream' : `${streams.length} Streams`}
      action={
        <Link to="/" onClick={() => setOpen(false)} className="text-xs font-medium text-accent hover:underline">
          Zum Dashboard
        </Link>
      }
      open={open}
      onOpenChange={setOpen}
    >
      {sessions.error && !sessions.data ? (
        <p className="px-4 py-6 text-center text-critical">{sessions.error.message}</p>
      ) : !sessions.data ? (
        <div aria-busy className="m-4 h-16 animate-pulse rounded-xl bg-card-2" />
      ) : streams.length === 0 ? (
        <p className="px-4 py-6 text-center text-ink-2">Gerade streamt niemand.</p>
      ) : (
        <ul className="max-h-[60dvh] divide-y divide-line overflow-y-auto">
          {streams.map((session) => (
            <StreamRow key={session.id} session={session} onFollow={() => setOpen(false)} />
          ))}
        </ul>
      )}
    </HeaderMenu>
  );
}

function StreamRow({ session, onFollow }: { session: StreamSession; onFollow: () => void }) {
  const { title, subtitle } = itemHeadline(session.item);
  const { playback, item } = session;
  const method = PLAY_METHODS[playback.method];
  const progress = item.durationMs ? Math.min(1, playback.positionMs / item.durationMs) : null;
  const trouble = session.health.severity === 'critical' || session.health.severity === 'warning';
  return (
    <li>
      <Link to="/" onClick={onFollow} className="block px-4 py-3 transition hover:bg-card-2/60">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-medium">
              {playback.isPaused && <Pause className="size-3.5 shrink-0 text-ink-3" aria-label="Pausiert" />}
              <span className="truncate" title={title}>
                {title}
              </span>
            </p>
            {subtitle && (
              <p className="truncate text-xs text-ink-2" title={subtitle}>
                {subtitle}
              </p>
            )}
          </div>
          <span className={clsx('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', method.tone)} title={method.description}>
            <method.icon className="size-3" aria-hidden />
            {method.label}
          </span>
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-2">
          {trouble && (
            <TriangleAlert
              className={clsx('size-3.5 shrink-0', session.health.severity === 'critical' ? 'text-critical' : 'text-warning')}
              aria-label="Hinweise im Dashboard"
            />
          )}
          <span className="truncate">
            {joinParts([session.user.name, session.device || session.client, session.estimatedBitrate !== null && formatBitrate(session.estimatedBitrate)])}
          </span>
        </p>
        {progress !== null && (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-accent/15">
            <div className={clsx('h-full rounded-full', playback.isPaused ? 'bg-ink-3' : 'bg-brand')} style={{ width: `${Math.max(progress * 100, 1)}%` }} />
          </div>
        )}
      </Link>
    </li>
  );
}
