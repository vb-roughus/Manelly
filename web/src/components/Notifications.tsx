import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { Bell, CircleCheck, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import clsx from 'clsx';
import { useNow } from '../hooks/useNow';
import { formatAgo } from '../lib/format';
import { useRestartNotifications } from './Restart';

/**
 * A message for the bell. `progress` is something under way; it goes by itself once done. The others stay until
 * closed, and count as new until the bell was opened.
 */
export interface AppNotification {
  id: string;
  tone: 'progress' | 'good' | 'critical';
  title: string;
  text: string;
  link?: { to: string; label: string };
  /** When it happened, in ms. */
  at?: number;
  onDismiss?: () => void;
}

/** Every message Manelly has for the bell; new kinds of messages add their source here. */
function useNotifications(): AppNotification[] {
  return useRestartNotifications();
}

const SEEN_KEY = 'manelly.notifications.seen';

/** The messages already seen, for the tab: both bells (phone and desktop) and a reload agree on what is new. */
const seenStore = (() => {
  const listeners = new Set<() => void>();
  let seen: string[] = [];
  try {
    seen = JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]') as string[];
  } catch {
    // Without storage everything counts as new after a reload.
  }
  return {
    get: () => seen,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mark(ids: string[]) {
      if (ids.every((id) => seen.includes(id))) return;
      // Only the last few: older ones are long closed.
      seen = [...new Set([...seen, ...ids])].slice(-50);
      try {
        sessionStorage.setItem(SEEN_KEY, JSON.stringify(seen));
      } catch {
        // See above.
      }
      for (const listener of listeners) listener();
    },
  };
})();

/** The bell with its count, and the list of messages it opens. */
export function NotificationBell({ className, panelClassName }: { className?: string; panelClassName?: string }) {
  const notifications = useNotifications();
  const seen = useSyncExternalStore(seenStore.subscribe, seenStore.get);
  const [open, setOpen] = useState(false);
  // What was new when the bell opened stays marked while it is open.
  const [fresh, setFresh] = useState<string[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const now = useNow(30_000);

  const busy = notifications.some((entry) => entry.tone === 'progress');
  const unread = notifications.filter((entry) => entry.tone !== 'progress' && !seen.includes(entry.id));
  const failed = unread.some((entry) => entry.tone === 'critical');

  // Open, what is there is seen – also what comes in while it is open.
  useEffect(() => {
    if (open) seenStore.mark(notifications.filter((entry) => entry.tone !== 'progress').map((entry) => entry.id));
  }, [open, notifications]);

  // A click elsewhere or Escape closes it.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const label = joinLabel(unread.length, busy);
  const dismissible = notifications.filter((entry) => entry.onDismiss);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!open) setFresh(unread.map((entry) => entry.id));
          setOpen(!open);
        }}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        title={label}
        className={clsx(
          'relative grid size-9 place-items-center rounded-lg text-ink-2 ring-1 ring-line transition hover:bg-card hover:text-ink',
          open && 'bg-card text-ink',
          className,
        )}
      >
        <Bell className="size-4" aria-hidden />
        {busy ? (
          <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-card ring-1 ring-line" aria-hidden>
            <LoaderCircle className="size-3 animate-spin text-accent" />
          </span>
        ) : (
          unread.length > 0 && (
            <span
              className={clsx(
                'absolute -top-1.5 -right-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] leading-none font-semibold text-white tabular-nums',
                failed ? 'bg-critical' : 'bg-accent',
              )}
              aria-hidden
            >
              {unread.length}
            </span>
          )
        )}
      </button>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Meldungen"
          className={clsx(
            'z-40 overflow-hidden rounded-2xl border border-line bg-card text-sm shadow-xl shadow-black/15',
            // On a phone across the screen below the top bar; on large screens hanging from the bell.
            'max-lg:fixed max-lg:inset-x-4 max-lg:top-16 lg:absolute lg:top-full lg:right-0 lg:mt-2 lg:w-96',
            panelClassName,
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <p className="font-semibold">Meldungen</p>
            {dismissible.length > 1 && (
              <button type="button" onClick={() => dismissible.forEach((entry) => entry.onDismiss?.())} className="text-xs font-medium text-accent hover:underline">
                Alle entfernen
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-center text-ink-2">Keine Meldungen.</p>
          ) : (
            <ul className="max-h-[60dvh] divide-y divide-line overflow-y-auto">
              {notifications.map((entry) => (
                <NotificationRow key={entry.id} entry={entry} isNew={fresh.includes(entry.id)} now={now} onFollow={() => setOpen(false)} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function joinLabel(unread: number, busy: boolean): string {
  if (busy) return 'Meldungen – gerade läuft etwas';
  if (unread === 1) return 'Meldungen – 1 neue';
  if (unread > 1) return `Meldungen – ${unread} neue`;
  return 'Meldungen';
}

function NotificationRow({ entry, isNew, now, onFollow }: { entry: AppNotification; isNew: boolean; now: number; onFollow: () => void }) {
  const Icon = entry.tone === 'progress' ? LoaderCircle : entry.tone === 'good' ? CircleCheck : TriangleAlert;
  return (
    <li className={clsx('flex items-start gap-3 px-4 py-3', isNew && 'bg-accent/6')} role={entry.tone === 'critical' ? 'alert' : 'status'}>
      <Icon
        className={clsx('mt-0.5 size-4 shrink-0', entry.tone === 'progress' ? 'animate-spin text-accent' : entry.tone === 'good' ? 'text-good' : 'text-critical')}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{entry.title}</p>
        <p className="break-words text-ink-2">{entry.text}</p>
        <p className="mt-1 flex flex-wrap gap-x-3 text-xs">
          {entry.at !== undefined && <span className="text-ink-3">{formatAgo(entry.at, now)}</span>}
          {entry.link && (
            <Link to={entry.link.to} onClick={onFollow} className="font-medium text-accent hover:underline">
              {entry.link.label}
            </Link>
          )}
        </p>
      </div>
      {entry.onDismiss && (
        <button type="button" onClick={entry.onDismiss} aria-label="Meldung entfernen" title="Entfernen" className="-mr-1 rounded-md p-0.5 text-ink-3 hover:text-ink">
          <X className="size-4" aria-hidden />
        </button>
      )}
    </li>
  );
}
