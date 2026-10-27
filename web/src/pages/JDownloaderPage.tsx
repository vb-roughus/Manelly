import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { LinkAvailability, LinkGrabberPackage, LinkGrabberStatus } from '@manelly/shared';
import { ArrowRightToLine, ChevronDown, CircleCheck, CircleHelp, CircleX, Download, Link2, LoaderCircle, Settings, X, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { Downloads, downloadsSummary } from '../components/DashboardDownloads';
import { Code, Message } from '../components/ConnectionForm';
import { JDownloaderForm } from '../components/JDownloaderForm';
import { useAgent, useAgentSettings, useJDownloader, useLinkGrabber, useMoveFromLinkGrabber } from '../hooks/queries';
import { formatBytes } from '../lib/format';

type Tab = 'downloads' | 'linkgrabber';
const TABS: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: 'downloads', label: 'Downloads', icon: Download },
  { id: 'linkgrabber', label: 'Link Grabber', icon: Link2 },
];

const button =
  'inline-flex items-center gap-1.5 rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-ink ring-1 ring-line transition hover:bg-card-2 disabled:cursor-wait disabled:opacity-60';

/** JDownloader on the Jellyfin server: its downloads and its link grabber; the settings sit behind the gear. */
export function JDownloaderPage() {
  useEffect(() => {
    document.title = 'JDownloader · Server · Manelly';
  }, []);
  // Tab and settings live in the address, so the dashboard can link straight to them.
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'linkgrabber' ? 'linkgrabber' : 'downloads';
  const settingsOpen = params.has('settings');
  const change = (update: (next: URLSearchParams) => void) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        update(next);
        return next;
      },
      { replace: true },
    );

  const agentSettings = useAgentSettings();
  const agent = useAgent({ enabled: Boolean(agentSettings.data?.url) });
  const status = agent.data?.status;
  const enabled = Boolean(status?.jdownloader?.enabled);
  const grabberSupported = Boolean(status?.jdownloader?.linkgrabber);
  const downloads = useJDownloader(enabled);
  // Slower while the other tab is open: enough for the count on the tab.
  const grabber = useLinkGrabber(enabled && grabberSupported, tab === 'linkgrabber' ? 4_000 : 15_000);

  const openSettings = () => change((next) => next.set('settings', ''));

  let content: ReactNode;
  if (agentSettings.data && !agentSettings.data.url) {
    content = (
      <Card>
        JDownloader erreicht Manelly über den Agent auf dem Jellyfin-Server. Zuerst den Agent unter{' '}
        <Link to="/server/agent" className="font-medium text-accent hover:underline">
          Server → Agent
        </Link>{' '}
        verbinden.
      </Card>
    );
  } else if (agent.data?.error) {
    content = <Message tone="critical">{agent.data.error}</Message>;
  } else if (!status) {
    content = <div aria-busy className="h-48 animate-pulse rounded-2xl bg-card-2" />;
  } else if (!enabled) {
    content = (
      <Card>
        <p className="font-medium">JDownloader ist nicht eingebunden</p>
        <p className="mt-1 text-sm text-ink-2">In den Einstellungen einschalten – dafür braucht JDownloader die «Deprecated API».</p>
        <button type="button" onClick={openSettings} className={clsx(button, 'mt-4')}>
          <Settings className="size-4" aria-hidden /> Einstellungen öffnen
        </button>
      </Card>
    );
  } else {
    const counts: Record<Tab, number | null> = {
      downloads: downloads.data?.reachable ? downloads.data.packages.filter((pkg) => !pkg.finished).length : null,
      linkgrabber: grabber.data ? grabber.data.packages.length : null,
    };
    content = (
      <>
        <TabList tab={tab} counts={counts} onSelect={(id) => change((next) => (id === 'downloads' ? next.delete('tab') : next.set('tab', id)))} />
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-4">
          {tab === 'downloads' ? (
            !downloads.data ? (
              downloads.error ? <Message tone="critical">{downloads.error.message}</Message> : <div aria-busy className="h-48 animate-pulse rounded-2xl bg-card-2" />
            ) : (
              <Card>{downloads.data.reachable ? <Downloads status={downloads.data} maxShown={Number.POSITIVE_INFINITY} /> : <p className="text-sm text-critical">{downloads.data.error}</p>}</Card>
            )
          ) : !grabberSupported ? (
            <Message tone="critical">
              Der Agent auf {status.hostname} ist zu alt für den Link Grabber (Version {status.version}). Auf dem Jellyfin-Server <Code>git pull</Code> und{' '}
              <Code>scripts\start-agent.cmd -Install</Code> ausführen.
            </Message>
          ) : !grabber.data ? (
            grabber.error ? <Message tone="critical">{grabber.error.message}</Message> : <div aria-busy className="h-48 animate-pulse rounded-2xl bg-card-2" />
          ) : (
            <LinkGrabber status={grabber.data} />
          )}
        </div>
      </>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-accent">Server</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">JDownloader</h1>
          <p className={clsx('mt-1 text-sm', downloads.data && !downloads.data.reachable ? 'text-critical' : 'text-ink-2')}>
            {enabled && downloads.data ? `JDownloader ${downloadsSummary(downloads.data)}` : 'JDownloader auf dem Jellyfin-Server, über den Agent.'}
          </p>
        </div>
        <button
          type="button"
          onClick={openSettings}
          aria-label="JDownloader-Einstellungen"
          title="Einstellungen"
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-card text-ink-2 ring-1 ring-line transition hover:bg-card-2 hover:text-ink"
        >
          <Settings className="size-5" aria-hidden />
        </button>
      </header>

      <div className="mt-6">{content}</div>
      <SettingsDialog open={settingsOpen} onClose={() => change((next) => next.delete('settings'))} />
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-line bg-card p-4 text-sm shadow-sm shadow-black/5 sm:p-5">{children}</div>;
}

function TabList({ tab, counts, onSelect }: { tab: Tab; counts: Record<Tab, number | null>; onSelect: (tab: Tab) => void }) {
  const refs = useRef<Record<Tab, HTMLButtonElement | null>>({ downloads: null, linkgrabber: null });

  // Arrow keys move between the tabs, as in any tab list.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const index = TABS.findIndex((entry) => entry.id === tab);
    const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!.id;
    onSelect(next);
    refs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label="JDownloader" onKeyDown={onKeyDown} className="flex gap-1 border-b border-line">
      {TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          ref={(element) => {
            refs.current[id] = element;
          }}
          type="button"
          role="tab"
          id={`tab-${id}`}
          aria-selected={tab === id}
          aria-controls={`panel-${id}`}
          tabIndex={tab === id ? 0 : -1}
          onClick={() => onSelect(id)}
          className={clsx(
            '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition outline-none focus-visible:ring-2 focus-visible:ring-accent',
            tab === id ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink',
          )}
        >
          <Icon className="size-4" aria-hidden />
          {label}
          {counts[id] !== null && <span className="rounded-full bg-card-2 px-1.5 text-xs tabular-nums text-ink-2">{counts[id]}</span>}
        </button>
      ))}
    </div>
  );
}

const AVAILABILITY: Record<LinkAvailability, { label: string; icon: LucideIcon; tone: string }> = {
  ONLINE: { label: 'online', icon: CircleCheck, tone: 'text-good' },
  OFFLINE: { label: 'offline', icon: CircleX, tone: 'text-critical' },
  UNKNOWN: { label: 'unbekannt', icon: CircleHelp, tone: 'text-ink-3' },
  TEMP_UNKNOWN: { label: 'gerade nicht prüfbar', icon: CircleHelp, tone: 'text-ink-3' },
};

/** Icon in the status color, the words in ink. */
function Availability({ state, count }: { state: LinkAvailability; count?: number }) {
  const { label, icon: Icon, tone } = AVAILABILITY[state];
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <Icon className={clsx('size-3.5 shrink-0', tone)} aria-hidden />
      {count !== undefined && <b className="font-medium tabular-nums">{count}</b>}
      {label}
    </span>
  );
}

/** What waits in JDownloader's link grabber, and moving it to the download list. */
function LinkGrabber({ status }: { status: LinkGrabberStatus }) {
  const move = useMoveFromLinkGrabber();
  const [open, setOpen] = useState<Set<number>>(new Set());
  const links = status.packages.reduce((sum, pkg) => sum + pkg.childCount, 0);
  const bytes = status.packages.reduce((sum, pkg) => sum + pkg.bytesTotal, 0);
  const toggle = (uuid: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
          <span className="whitespace-nowrap">
            {status.packages.length
              ? `${status.packages.length} ${status.packages.length === 1 ? 'Paket' : 'Pakete'} · ${links} ${links === 1 ? 'Link' : 'Links'}${bytes ? ` · ${formatBytes(bytes)}` : ''}`
              : 'Der Link Grabber ist leer.'}
          </span>
          {status.collecting && (
            <span className="inline-flex items-center gap-1.5 text-ink">
              <LoaderCircle className="size-3.5 animate-spin text-accent" aria-hidden /> sammelt und prüft Links …
            </span>
          )}
        </p>
        <button
          type="button"
          className={button}
          disabled={move.isPending || status.packages.length === 0}
          onClick={() => move.mutate({ packageIds: status.packages.map((pkg) => pkg.uuid), linkIds: [] })}
        >
          <ArrowRightToLine className="size-4" aria-hidden /> Alle in die Downloads
        </button>
      </div>
      {move.isError && <Message tone="critical">{move.error.message}</Message>}

      {status.packages.length > 0 && (
        <ul className="space-y-2">
          {status.packages.map((pkg) => (
            <GrabberPackage key={pkg.uuid} pkg={pkg} open={open.has(pkg.uuid)} onToggle={() => toggle(pkg.uuid)} move={move} />
          ))}
        </ul>
      )}
    </div>
  );
}

function GrabberPackage({ pkg, open, onToggle, move }: { pkg: LinkGrabberPackage; open: boolean; onToggle: () => void; move: ReturnType<typeof useMoveFromLinkGrabber> }) {
  const details = [`${pkg.childCount} ${pkg.childCount === 1 ? 'Datei' : 'Dateien'}`, pkg.bytesTotal ? formatBytes(pkg.bytesTotal) : null, pkg.hosts.join(', ') || null, !pkg.enabled ? 'deaktiviert' : null].filter(Boolean);
  return (
    <li className="rounded-xl border border-line bg-card shadow-sm shadow-black/5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
        {/* On a phone the name gets its own row; status and button follow below. */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`grabber-${pkg.uuid}`}
          className="flex w-full min-w-0 items-start gap-2 text-left sm:w-auto sm:flex-1"
        >
          <ChevronDown className={clsx('mt-0.5 size-4 shrink-0 text-ink-3 transition', !open && '-rotate-90')} aria-hidden />
          <span className="min-w-0">
            <span className="block truncate font-medium" title={pkg.saveTo ?? undefined}>
              {pkg.name}
            </span>
            <span className="block truncate text-xs text-ink-3">{details.join(' · ')}</span>
          </span>
        </button>
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2">
          {pkg.online > 0 && <Availability state="ONLINE" count={pkg.online} />}
          {pkg.offline > 0 && <Availability state="OFFLINE" count={pkg.offline} />}
          {pkg.unknown > 0 && <Availability state="UNKNOWN" count={pkg.unknown} />}
        </span>
        <button
          type="button"
          className={clsx(button, 'ml-auto sm:ml-0')}
          disabled={move.isPending}
          onClick={() => move.mutate({ packageIds: [pkg.uuid], linkIds: [] })}
          aria-label={`${pkg.name} in die Downloads übernehmen`}
        >
          <ArrowRightToLine className="size-4" aria-hidden /> In die Downloads
        </button>
      </div>
      {open && (
        <ul id={`grabber-${pkg.uuid}`} className="divide-y divide-line border-t border-line">
          {pkg.links.length === 0 && <li className="px-3 py-2 text-xs text-ink-3">JDownloader hat für dieses Paket noch keine Links gemeldet.</li>}
          {pkg.links.map((link) => (
            <li key={link.uuid} className={clsx('grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-3 py-2 text-sm sm:grid-cols-[1fr_auto_auto_auto]', !link.enabled && 'opacity-60')}>
              <span className="min-w-0 truncate pl-6" title={link.name}>
                {link.name}
              </span>
              <span className="text-xs text-ink-2">
                <Availability state={link.availability} />
              </span>
              <span className="hidden text-xs text-ink-3 tabular-nums sm:block">{[link.host, link.bytesTotal ? formatBytes(link.bytesTotal) : null].filter(Boolean).join(' · ')}</span>
              <button
                type="button"
                disabled={move.isPending}
                onClick={() => move.mutate({ packageIds: [], linkIds: [link.uuid] })}
                aria-label={`${link.name} in die Downloads übernehmen`}
                className="justify-self-end text-xs font-medium text-accent hover:underline disabled:opacity-60 max-sm:col-span-2"
              >
                übernehmen
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** The former JDownloader settings, behind the gear. */
function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      aria-labelledby="jdownloader-settings-heading"
      className="m-auto max-h-[90dvh] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-line bg-card p-0 text-ink shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      {open && (
        <div className="p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 id="jdownloader-settings-heading" className="flex items-center gap-2.5 text-lg font-semibold">
                <span className="grid size-8 place-items-center rounded-lg bg-accent/12 text-accent">
                  <Settings className="size-4" aria-hidden />
                </span>
                JDownloader-Einstellungen
              </h2>
              <p className="mt-1 text-sm text-ink-2">Ob Manelly JDownloader zeigt, wo der Agent ihn erreicht, und was beim Streamen passiert.</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Schliessen" className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-card-2 hover:text-ink">
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <JDownloaderForm />
        </div>
      )}
    </dialog>
  );
}
