import { addTransitionType, startTransition, useEffect, useRef, useState, ViewTransition, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type {
  JDownloaderAccount,
  JDownloaderAccounts,
  JDownloaderAccountState,
  LinkAvailability,
  LinkGrabberPackage,
  LinkGrabberRemoveRequest,
  LinkGrabberStatus,
} from '@manelly/shared';
import {
  ArrowRightToLine,
  ChevronDown,
  CircleCheck,
  CircleHelp,
  CircleMinus,
  CircleX,
  Clock,
  Download,
  FileUp,
  KeyRound,
  Link2,
  LoaderCircle,
  PackageOpen,
  RefreshCw,
  Settings,
  Trash2,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { Downloads, downloadsSummary, isActivePackage } from '../components/DashboardDownloads';
import { Code, Message } from '../components/ConnectionForm';
import { ExtractedList } from '../components/ExtractedList';
import { JDownloaderForm } from '../components/JDownloaderForm';
import { Modal } from '../components/Modal';
import { keepTextOnShift, Tick } from '../components/Tick';
import {
  useAddLinkGrabberContainer,
  useAgent,
  useAgentSettings,
  useExtracted,
  useJDownloader,
  useJDownloaderAccounts,
  useLinkGrabber,
  useMoveFromLinkGrabber,
  useRefreshJDownloaderAccounts,
  useRemoveFromLinkGrabber,
} from '../hooks/queries';
import { containerProblem } from '../lib/containers';
import {
  allState,
  clickLink,
  clickPackage,
  describeSelection,
  isEmpty,
  linkSelected,
  NOTHING_SELECTED,
  packageState,
  pruneSelection,
  selectedLinks,
  selectionRequest,
  toggleAll,
  type PackageSelection,
  type SelectionAnchor,
} from '../lib/packageSelection';
import { formatBytes } from '../lib/format';

type Tab = 'downloads' | 'linkgrabber' | 'accounts' | 'extracted';
/** `short` and no icons keep the tabs narrow on a phone. */
const TABS: Array<{ id: Tab; label: string; short?: string; icon: LucideIcon }> = [
  { id: 'downloads', label: 'Downloads', icon: Download },
  { id: 'linkgrabber', label: 'Link Grabber', short: 'Grabber', icon: Link2 },
  { id: 'accounts', label: 'Premium-Accounts', short: 'Accounts', icon: KeyRound },
  { id: 'extracted', label: 'Extracted', icon: PackageOpen },
];
const isTab = (value: string | null): value is Tab => TABS.some((entry) => entry.id === value);
const TAB_ENTER = { 'tab-next': 'tab-in-next', 'tab-previous': 'tab-in-previous', default: 'none' };
const TAB_EXIT = { 'tab-next': 'tab-out-next', 'tab-previous': 'tab-out-previous', default: 'none' };

const button =
  'inline-flex items-center gap-1.5 rounded-lg bg-card px-3 py-1.5 text-sm font-medium text-ink ring-1 ring-line transition hover:bg-card-2 disabled:cursor-wait disabled:opacity-60';
const primaryButton =
  'bg-brand inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70';
const dangerButton =
  'inline-flex items-center gap-1.5 rounded-lg bg-critical px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60';
/** Agents before 0.29.0 cannot delete in JDownloader. */
const REMOVE_TOO_OLD = 'Löschen geht ab Agent 0.29.0 – unter Server → Agent «Aktualisieren & neu starten».';

/** JDownloader on the Jellyfin server: its downloads and its link grabber; the settings sit behind the gear. */
export function JDownloaderPage() {
  useEffect(() => {
    document.title = 'JDownloader · Server · Manelly';
  }, []);
  // Tab and settings live in the address, so the dashboard can link straight to them.
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: Tab = isTab(requested) ? requested : 'downloads';
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
  // With the parts of every package, so they can be opened.
  const downloads = useJDownloader(enabled, 4_000, true);
  // Slower while the other tab is open: enough for the count on the tab.
  const grabber = useLinkGrabber(enabled && grabberSupported, tab === 'linkgrabber' ? 4_000 : 15_000);
  const accountsSupported = Boolean(status?.jdownloader?.accounts);
  // Traffic and premium time change slowly; JDownloader itself checks the hosters only now and then.
  const accounts = useJDownloaderAccounts(enabled && accountsSupported, tab === 'accounts' ? 30_000 : false);
  const extractedSupported = Boolean(status?.jdownloader?.extracted);
  // Read only while the tab is open, so the folder is not counted through on every visit; the count stays afterwards.
  const extracted = useExtracted('', enabled && extractedSupported && tab === 'extracted');

  const openSettings = () => change((next) => next.set('settings', ''));
  // Animated by direction: a tab further right slides in from the right.
  const selectTab = (id: Tab) =>
    startTransition(() => {
      const order = (entry: Tab) => TABS.findIndex((candidate) => candidate.id === entry);
      addTransitionType(order(id) > order(tab) ? 'tab-next' : 'tab-previous');
      change((next) => (id === 'downloads' ? next.delete('tab') : next.set('tab', id)));
    });

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
      downloads: downloads.data?.reachable ? downloads.data.packages.filter(isActivePackage).length : null,
      linkgrabber: grabber.data ? grabber.data.packages.length : null,
      accounts: accounts.data ? accounts.data.accounts.length : null,
      extracted: extracted.data?.directory && !extracted.data.error ? extracted.data.entries.length : null,
    };
    content = (
      <>
        <TabList tab={tab} counts={counts} onSelect={selectTab} />
        {/* The new tab slides in from the side it sits on (see index.css); other updates of the panel stay still. */}
        <ViewTransition key={tab} enter={TAB_ENTER} exit={TAB_EXIT} default="none">
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-4">
            {tab === 'downloads' ? (
              !downloads.data ? (
                downloads.error ? <Message tone="critical">{downloads.error.message}</Message> : <div aria-busy className="h-48 animate-pulse rounded-2xl bg-card-2" />
              ) : (
                <Card>
                  {downloads.data.reachable ? (
                    <Downloads status={downloads.data} maxShown={Number.POSITIVE_INFINITY} expandable removable={Boolean(status.jdownloader?.remove)} />
                  ) : (
                    <p className="text-sm text-critical">{downloads.data.error}</p>
                  )}
                </Card>
              )
            ) : tab === 'extracted' ? (
              extractedSupported ? (
                <ExtractedList
                  onOpenSettings={openSettings}
                  actions={Boolean(status.jdownloader?.moves)}
                  newFolders={Boolean(status.jdownloader?.newFolders)}
                  deletable={Boolean(status.jdownloader?.extractedDelete)}
                />
              ) : (
                <Message tone="critical">
                  Der Agent auf {status.hostname} ist zu alt für den Entpack-Ordner (Version {status.version}). Unter{' '}
                  <Link to="/server/agent" className="font-medium underline">
                    Server → Agent
                  </Link>{' '}
                  «Aktualisieren & neu starten».
                </Message>
              )
            ) : tab === 'accounts' ? (
              !accountsSupported ? (
                <Message tone="critical">
                  Der Agent auf {status.hostname} ist zu alt für die Premium-Accounts (Version {status.version}). Unter{' '}
                  <Link to="/server/agent" className="font-medium underline">
                    Server → Agent
                  </Link>{' '}
                  «Aktualisieren & neu starten».
                </Message>
              ) : !accounts.data ? (
                accounts.error ? <Message tone="critical">{accounts.error.message}</Message> : <div aria-busy className="h-48 animate-pulse rounded-2xl bg-card-2" />
              ) : (
                <Accounts data={accounts.data} />
              )
            ) : !grabberSupported ? (
              <Message tone="critical">
                Der Agent auf {status.hostname} ist zu alt für den Link Grabber (Version {status.version}). Auf dem Jellyfin-Server <Code>git pull</Code> und{' '}
                <Code>scripts\start-agent.cmd -Install</Code> ausführen.
              </Message>
            ) : !grabber.data ? (
              grabber.error ? <Message tone="critical">{grabber.error.message}</Message> : <div aria-busy className="h-48 animate-pulse rounded-2xl bg-card-2" />
            ) : (
              <LinkGrabber
                status={grabber.data}
                removable={Boolean(status.jdownloader?.remove)}
                tooOld={
                  status.jdownloader?.containers
                    ? null
                    : `Der Agent auf ${status.hostname} ist zu alt für DLC-Dateien (Version ${status.version}). Unter Server → Agent «Aktualisieren & neu starten».`
                }
              />
            )}
          </div>
        </ViewTransition>
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
  const refs = useRef<Record<Tab, HTMLButtonElement | null>>({ downloads: null, linkgrabber: null, accounts: null, extracted: null });

  // Where the tabs still do not fit, the open one is scrolled into sight.
  useEffect(() => {
    refs.current[tab]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab]);

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
    // Scrolls sideways only where the tabs do not fit; the line below is drawn inside, so nothing sticks out to scroll.
    <div role="tablist" aria-label="JDownloader" onKeyDown={onKeyDown} className="flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--line)]">
      {TABS.map(({ id, label, short, icon: Icon }) => (
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
            'flex shrink-0 items-center gap-2 border-b-2 px-2 py-2 text-[13px] font-medium whitespace-nowrap transition outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset sm:px-3 sm:text-sm',
            tab === id ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink',
          )}
        >
          <Icon className="hidden size-4 sm:block" aria-hidden />
          {short ? (
            <>
              <span className="sm:hidden">{short}</span>
              <span className="hidden sm:inline">{label}</span>
            </>
          ) : (
            label
          )}
          {/* On a phone only the open tab shows its count, so all tabs fit in one line. */}
          {counts[id] !== null && (
            <span className={clsx('rounded-full bg-card-2 px-1.5 text-xs tabular-nums text-ink-2', tab !== id && 'hidden sm:inline')}>{counts[id]}</span>
          )}
        </button>
      ))}
    </div>
  );
}

const ACCOUNT_STATES: Record<JDownloaderAccountState, { label: string; icon: LucideIcon; tone: string }> = {
  ok: { label: 'Aktiv', icon: CircleCheck, tone: 'text-good' },
  blocked: { label: 'Vorübergehend gesperrt', icon: Clock, tone: 'text-warning' },
  expired: { label: 'Abgelaufen', icon: CircleX, tone: 'text-critical' },
  invalid: { label: 'Ungültig', icon: CircleX, tone: 'text-critical' },
  error: { label: 'Fehler', icon: TriangleAlert, tone: 'text-critical' },
  disabled: { label: 'Ausgeschaltet', icon: CircleMinus, tone: 'text-ink-3' },
  unchecked: { label: 'Nicht geprüft', icon: CircleHelp, tone: 'text-ink-3' },
};

const DAY = 86_400_000;

/** The premium accounts configured in JDownloader, with how long and how much each has left. */
function Accounts({ data }: { data: JDownloaderAccounts }) {
  const refresh = useRefreshJDownloaderAccounts();
  const usable = data.accounts.filter((account) => account.state === 'ok').length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">
          {data.accounts.length
            ? `${data.accounts.length} ${data.accounts.length === 1 ? 'Account' : 'Accounts'} · ${usable} aktiv`
            : 'In JDownloader ist kein Account eingerichtet.'}
        </p>
        {data.accounts.length > 0 && (
          <button type="button" className={button} disabled={refresh.isPending} onClick={() => refresh.mutate([])} title="JDownloader fragt die Hoster nach Laufzeit und Traffic">
            <RefreshCw className={clsx('size-4', refresh.isPending && 'animate-spin')} aria-hidden /> Neu prüfen
          </button>
        )}
      </div>
      {refresh.isSuccess && <p className="text-xs text-ink-3">JDownloader fragt die Hoster – die neuen Werte erscheinen in ein paar Sekunden.</p>}
      {refresh.isError && <Message tone="critical">{refresh.error.message}</Message>}
      {data.accounts.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.accounts.map((account) => (
            <AccountCard key={account.id} account={account} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AccountCard({ account }: { account: JDownloaderAccount }) {
  const { label, icon: Icon, tone } = ACCOUNT_STATES[account.state];
  const share = account.trafficLeft !== null && account.trafficMax ? Math.min(1, account.trafficLeft / account.trafficMax) : null;
  const until = account.validUntil ? Date.parse(account.validUntil) : null;
  const days = until === null ? null : Math.ceil((until - Date.now()) / DAY);
  const date = until === null ? null : new Date(until).toLocaleDateString('de-CH', { dateStyle: 'medium' });
  return (
    <li className={clsx('rounded-xl border border-line bg-card p-3 shadow-sm shadow-black/5', account.state === 'disabled' && 'opacity-70')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{account.hoster}</p>
          <p className="truncate text-xs text-ink-3">{account.username ?? 'ohne Benutzername'}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium whitespace-nowrap">
          <Icon className={clsx('size-3.5', tone)} aria-hidden /> {label}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-2">Traffic</dt>
        <dd className="min-w-0">
          {account.unlimited
            ? 'unbegrenzt'
            : account.trafficLeft !== null
              ? `${formatBytes(account.trafficLeft)} übrig${account.trafficMax ? ` von ${formatBytes(account.trafficMax)}` : ''}`
              : 'unbekannt'}
          {share !== null && (
            <div className="mt-1 h-1.5 rounded-full bg-card-2" role="meter" aria-label={`Traffic übrig bei ${account.hoster}`} aria-valuenow={Math.round(share * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div
                className={clsx('h-full rounded-full', share < 0.1 ? 'bg-critical' : share < 0.25 ? 'bg-warning' : 'bg-good')}
                style={{ width: `${Math.max(share * 100, 1)}%` }}
              />
            </div>
          )}
        </dd>
        <dt className="text-ink-2">Premium</dt>
        <dd className={clsx(days !== null && days <= 7 && 'text-critical')}>
          {days === null ? 'ohne Ablaufdatum' : days < 0 ? `abgelaufen am ${date}` : `bis ${date} · noch ${days === 1 ? '1 Tag' : `${days} Tage`}`}
        </dd>
      </dl>
      {account.error && account.state !== 'ok' && <p className="mt-2 text-xs text-ink-2">{account.error}</p>}
    </li>
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

interface Upload {
  key: number;
  name: string;
  state: 'sending' | 'added' | 'failed';
  message: string | null;
}

/** DLC files for the link grabber, one after the other, each with how it went. */
function useContainerUploads(tooOld: string | null) {
  const add = useAddLinkGrabberContainer();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const nextKey = useRef(0);

  async function upload(files: File[]) {
    if (!files.length) return;
    const batch = files.map((file): Upload => ({ key: nextKey.current++, name: file.name, state: 'sending', message: null }));
    setUploads(batch);
    const update = (key: number, change: Pick<Upload, 'state' | 'message'>) =>
      setUploads((current) => current.map((entry) => (entry.key === key ? { ...entry, ...change } : entry)));
    for (const [index, file] of files.entries()) {
      const { key } = batch[index]!;
      const problem = containerProblem(file);
      if (tooOld || problem) {
        update(key, { state: 'failed', message: tooOld ?? `${file.name} ${problem}` });
        continue;
      }
      try {
        await add.mutateAsync(file);
        update(key, { state: 'added', message: null });
      } catch (error) {
        update(key, { state: 'failed', message: (error as Error).message });
      }
    }
  }

  return { uploads, upload, busy: uploads.some((entry) => entry.state === 'sending'), clear: () => setUploads([]) };
}

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');

/** What waits in JDownloader's link grabber, and moving it to the download list; DLC files are picked or dropped onto it. */
function LinkGrabber({ status, removable, tooOld }: { status: LinkGrabberStatus; removable: boolean; tooOld: string | null }) {
  const move = useMoveFromLinkGrabber();
  const remove = useRemoveFromLinkGrabber();
  // What to remove, asked first.
  const [removing, setRemoving] = useState<LinkGrabberRemoveRequest | null>(null);
  const [anchor, setAnchor] = useState<SelectionAnchor>(null);
  const { uploads, upload, busy, clear } = useContainerUploads(tooOld);
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [ticked, setTicked] = useState<PackageSelection>(NOTHING_SELECTED);
  // What JDownloader moved or removed meanwhile is no longer ticked.
  const selection = pruneSelection(ticked, status.packages);
  const chosen = selectedLinks(selection, status.packages);
  const moveSelection = () => move.mutate(selectionRequest(selection), { onSuccess: () => setTicked(NOTHING_SELECTED) });
  const links = status.packages.reduce((sum, pkg) => sum + pkg.childCount, 0);
  const bytes = status.packages.reduce((sum, pkg) => sum + pkg.bytesTotal, 0);
  const toggle = (uuid: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  }

  return (
    <div
      className="relative space-y-3"
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setDragging(false);
        void upload([...event.dataTransfer.files]);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute -inset-2 z-10 grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-card/90 text-sm font-medium text-accent">
          <span className="flex items-center gap-2">
            <FileUp className="size-5" aria-hidden /> DLC-Dateien hier ablegen
          </span>
        </div>
      )}
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          void upload([...(event.target.files ?? [])]);
          // The same file again counts as a change, too.
          event.target.value = '';
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
          {status.packages.length > 0 && (
            <span className="flex items-center pl-3">
              <Tick state={allState(selection, status.packages)} label="Alle Pakete auswählen" onChange={() => setTicked(toggleAll(selection, status.packages))} />
            </span>
          )}
          <span className="whitespace-nowrap">
            {chosen > 0
              ? `${chosen} ${chosen === 1 ? 'Link' : 'Links'} ausgewählt`
              : status.packages.length
                ? `${status.packages.length} ${status.packages.length === 1 ? 'Paket' : 'Pakete'} · ${links} ${links === 1 ? 'Link' : 'Links'}${bytes ? ` · ${formatBytes(bytes)}` : ''}`
                : 'Der Link Grabber ist leer.'}
          </span>
          {!isEmpty(selection) && (
            <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => setTicked(NOTHING_SELECTED)}>
              Auswahl aufheben
            </button>
          )}
          {status.collecting && (
            <span className="inline-flex items-center gap-1.5 text-ink">
              <LoaderCircle className="size-3.5 animate-spin text-accent" aria-hidden /> sammelt und prüft Links …
            </span>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={busy} onClick={() => picker.current?.click()}>
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <FileUp className="size-4" aria-hidden />} DLC hochladen
          </button>
          {isEmpty(selection) ? (
            <button
              type="button"
              className={button}
              disabled={move.isPending || status.packages.length === 0}
              onClick={() => move.mutate({ packageIds: status.packages.map((pkg) => pkg.uuid), linkIds: [] })}
            >
              <ArrowRightToLine className="size-4" aria-hidden /> Alle in die Downloads
            </button>
          ) : (
            <>
              <button
                type="button"
                className={button}
                disabled={!removable || remove.isPending}
                title={removable ? undefined : REMOVE_TOO_OLD}
                onClick={() => setRemoving(selectionRequest(selection))}
              >
                <Trash2 className="size-4" aria-hidden /> Löschen
              </button>
              <button type="button" className={primaryButton} disabled={move.isPending} onClick={moveSelection}>
                <ArrowRightToLine className="size-4" aria-hidden /> Auswahl in die Downloads
              </button>
            </>
          )}
        </div>
      </div>
      {move.isError && <Message tone="critical">{move.error.message}</Message>}
      {remove.isError && <Message tone="critical">{remove.error.message}</Message>}
      <Uploads uploads={uploads} busy={busy} onClear={clear} />

      {status.packages.length === 0 && (
        <button
          type="button"
          onClick={() => picker.current?.click()}
          disabled={busy}
          className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line px-4 py-8 text-sm text-ink-2 transition hover:border-accent hover:text-ink disabled:cursor-wait"
        >
          <FileUp className="size-6 text-ink-3" aria-hidden />
          DLC-Datei auswählen oder hierher ziehen
        </button>
      )}

      {status.packages.length > 0 && (
        <ul className="space-y-2" onMouseDown={keepTextOnShift}>
          {status.packages.map((pkg) => (
            <GrabberPackage
              key={pkg.uuid}
              pkg={pkg}
              open={open.has(pkg.uuid)}
              onToggle={() => toggle(pkg.uuid)}
              move={move}
              selection={selection}
              onPick={(shift) => {
                setTicked(clickPackage(selection, status.packages, pkg, anchor, shift));
                setAnchor({ package: pkg.uuid, link: null });
              }}
              onPickLink={(uuid, shift) => {
                setTicked(clickLink(selection, pkg, pkg.links.map((link) => link.uuid), uuid, anchor, shift));
                setAnchor({ package: pkg.uuid, link: uuid });
              }}
              onRemove={removable ? () => setRemoving({ packageIds: [pkg.uuid], linkIds: [] }) : undefined}
            />
          ))}
        </ul>
      )}
      <Modal open={removing !== null} onClose={() => setRemoving(null)} icon={Trash2} tone="critical" title="Aus dem Link Grabber entfernen">
        {removing && (
          <RemoveFromGrabber
            request={removing}
            packages={status.packages}
            pending={remove.isPending}
            onCancel={() => setRemoving(null)}
            onConfirm={() =>
              remove.mutate(removing, {
                onSuccess: () => {
                  setRemoving(null);
                  setTicked(NOTHING_SELECTED);
                },
              })
            }
          />
        )}
      </Modal>
    </div>
  );
}

/** What leaves the link grabber, asked first; nothing of it was downloaded yet. */
function RemoveFromGrabber({
  request,
  packages,
  pending,
  onCancel,
  onConfirm,
}: {
  request: LinkGrabberRemoveRequest;
  packages: LinkGrabberPackage[];
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const whole = packages.filter((pkg) => request.packageIds.includes(pkg.uuid));
  const names = [
    ...whole.map((pkg) => pkg.name),
    ...packages.flatMap((pkg) => pkg.links.filter((link) => request.linkIds.includes(link.uuid)).map((link) => link.name)),
  ];
  const inPackages = whole.reduce((sum, pkg) => sum + pkg.childCount, 0);
  return (
    <div className="space-y-4 text-sm">
      <p>
        <span className="font-medium">
          {describeSelection(whole.length, inPackages, request.linkIds.length, { item: ['Link', 'Links'], single: ['einzelner Link', 'einzelne Links'] })}
        </span>{' '}
        – heruntergeladen ist davon noch nichts. Wer sie später doch will, fügt sie in JDownloader neu hinzu.
      </p>
      <ul className="rounded-xl bg-card-2/50 p-3 text-xs text-ink-2 ring-1 ring-line">
        {names.slice(0, 6).map((name, index) => (
          <li key={`${index}-${name}`} className="truncate">
            {name}
          </li>
        ))}
        {names.length > 6 && <li>und {names.length - 6} weitere</li>}
      </ul>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className={button}>
          Abbrechen
        </button>
        <button type="button" onClick={onConfirm} disabled={pending} className={dangerButton}>
          {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />} Entfernen
        </button>
      </div>
    </div>
  );
}

/** How the DLC files went: handed over, or why not. */
function Uploads({ uploads, busy, onClear }: { uploads: Upload[]; busy: boolean; onClear: () => void }) {
  if (!uploads.length) return null;
  const added = uploads.some((entry) => entry.state === 'added');
  return (
    <div role="status" className="rounded-xl border border-line bg-card p-3 text-sm shadow-sm shadow-black/5">
      <div className="flex items-start justify-between gap-3">
        <ul className="min-w-0 space-y-1">
          {uploads.map((entry) => (
            <li key={entry.key} className="flex items-start gap-2">
              {entry.state === 'sending' ? (
                <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-accent" aria-hidden />
              ) : entry.state === 'added' ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-good" aria-hidden />
              ) : (
                <CircleX className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden />
              )}
              <span className="min-w-0 break-words">
                {entry.state === 'failed' ? (
                  entry.message
                ) : (
                  <>
                    <b className="font-medium">{entry.name}</b> <span className="text-ink-2">{entry.state === 'sending' ? 'wird übergeben …' : 'an JDownloader übergeben'}</span>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
        {!busy && (
          <button type="button" onClick={onClear} aria-label="Meldungen schliessen" className="grid size-6 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-card-2 hover:text-ink">
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {added && !busy && <p className="mt-2 text-xs text-ink-3">JDownloader liest die Dateien jetzt – ihre Pakete erscheinen gleich hier.</p>}
    </div>
  );
}

interface GrabberPackageProps {
  pkg: LinkGrabberPackage;
  open: boolean;
  onToggle: () => void;
  move: ReturnType<typeof useMoveFromLinkGrabber>;
  selection: PackageSelection;
  /** A click on the package's box, or on one of its links' boxes; with shift, for a range. */
  onPick: (shift: boolean) => void;
  onPickLink: (uuid: number, shift: boolean) => void;
  /** Missing while the agent cannot delete. */
  onRemove?: () => void;
}

function GrabberPackage({ pkg, open, onToggle, move, selection, onPick, onPickLink, onRemove }: GrabberPackageProps) {
  const details = [`${pkg.childCount} ${pkg.childCount === 1 ? 'Datei' : 'Dateien'}`, pkg.bytesTotal ? formatBytes(pkg.bytesTotal) : null, pkg.hosts.join(', ') || null, !pkg.enabled ? 'deaktiviert' : null].filter(Boolean);
  const state = packageState(selection, pkg);
  return (
    <li className={clsx('rounded-xl border bg-card shadow-sm shadow-black/5 transition', state === 'none' ? 'border-line' : 'border-accent/50')}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
        {/* On a phone the name gets its own row; status and button follow below. */}
        <div className="flex w-full min-w-0 items-start gap-2.5 sm:w-auto sm:flex-1">
          <span className="flex h-5 items-center">
            <Tick state={state} label={`${pkg.name} auswählen`} onChange={onPick} />
          </span>
          <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`grabber-${pkg.uuid}`} className="flex min-w-0 flex-1 items-start gap-2 text-left">
            <ChevronDown className={clsx('mt-0.5 size-4 shrink-0 text-ink-3 transition', !open && '-rotate-90')} aria-hidden />
            <span className="min-w-0">
              <span className="block truncate font-medium" title={pkg.saveTo ?? undefined}>
                {pkg.name}
              </span>
              <span className="block truncate text-xs text-ink-3">{details.join(' · ')}</span>
            </span>
          </button>
        </div>
        <span className="flex flex-wrap gap-x-3 gap-y-1 pl-6.5 text-xs text-ink-2 sm:pl-0">
          {pkg.online > 0 && <Availability state="ONLINE" count={pkg.online} />}
          {pkg.offline > 0 && <Availability state="OFFLINE" count={pkg.offline} />}
          {pkg.unknown > 0 && <Availability state="UNKNOWN" count={pkg.unknown} />}
        </span>
        <span className="ml-auto flex gap-2 sm:ml-0">
          {onRemove && (
            <button type="button" className={clsx(button, 'px-2')} onClick={onRemove} aria-label={`${pkg.name} aus dem Link Grabber entfernen`} title="Aus dem Link Grabber entfernen">
              <Trash2 className="size-4" aria-hidden />
            </button>
          )}
          <button
            type="button"
            className={button}
            disabled={move.isPending}
            onClick={() => move.mutate({ packageIds: [pkg.uuid], linkIds: [] })}
            aria-label={`${pkg.name} in die Downloads übernehmen`}
          >
            <ArrowRightToLine className="size-4" aria-hidden /> In die Downloads
          </button>
        </span>
      </div>
      {open && (
        <ul id={`grabber-${pkg.uuid}`} className="divide-y divide-line border-t border-line">
          {pkg.links.length === 0 && <li className="px-3 py-2 text-xs text-ink-3">JDownloader hat für dieses Paket noch keine Links gemeldet.</li>}
          {pkg.links.map((link) => (
            <li key={link.uuid} className={clsx('text-sm', !link.enabled && 'opacity-60')}>
              {/* The whole row ticks the link. */}
              <label className="grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-card-2/50 sm:grid-cols-[auto_1fr_auto_auto]">
                <span className="flex items-center pl-6">
                  <Tick state={linkSelected(selection, pkg, link.uuid) ? 'all' : 'none'} label={`${link.name} auswählen`} onChange={(shift) => onPickLink(link.uuid, shift)} />
                </span>
                <span className="min-w-0 truncate" title={link.name}>
                  {link.name}
                </span>
                <span className="text-xs text-ink-2">
                  <Availability state={link.availability} />
                </span>
                <span className="hidden text-xs text-ink-3 tabular-nums sm:block">{[link.host, link.bytesTotal ? formatBytes(link.bytesTotal) : null].filter(Boolean).join(' · ')}</span>
              </label>
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
