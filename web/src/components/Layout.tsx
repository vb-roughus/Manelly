import { useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import {
  Archive,
  ChevronDown,
  Cpu,
  Download,
  LayoutDashboard,
  Library,
  ListChecks,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Server,
  ServerCog,
  Settings,
  SlidersHorizontal,
  Stethoscope,
  Sun,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { isConfigured, useServerStatus, useSettings } from '../hooks/queries';
import { usePersistentFlag } from '../hooks/usePersistentFlag';
import { useStickyError } from '../hooks/useStickyError';
import { RestartNotices } from './Restart';
import { useTheme, type Theme } from '../hooks/useTheme';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** A heading that opens and closes the entries below it; not a page of its own. */
interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  children: NavItem[];
}

const NAV: Array<NavItem | NavGroup> = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/media', label: 'Medien', icon: Library },
  {
    id: 'conversions',
    label: 'Umwandlungen',
    icon: WandSparkles,
    children: [
      { to: '/conversions/overview', label: 'Übersicht', icon: ListChecks },
      { to: '/conversions/backups', label: 'Backups', icon: Archive },
      { to: '/conversions/settings', label: 'Einstellungen', icon: SlidersHorizontal },
    ],
  },
  {
    id: 'server',
    label: 'Server',
    icon: Server,
    children: [
      { to: '/server/general', label: 'Allgemein', icon: Cpu },
      { to: '/server/agent', label: 'Agent', icon: ServerCog },
      { to: '/server/jdownloader', label: 'JDownloader', icon: Download },
    ],
  },
  { to: '/troubleshooting', label: 'Troubleshooting', icon: Stethoscope },
];

const isGroup = (entry: NavItem | NavGroup): entry is NavGroup => 'children' in entry;

const SETTINGS: NavItem = { to: '/settings', label: 'Einstellungen', icon: Settings };

// The sidebar collapses to an icon rail on large screens only; small screens show a top bar instead.
export function Layout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = usePersistentFlag('manelly.sidebar.collapsed', false);

  return (
    <div
      className={clsx(
        'min-h-dvh lg:grid lg:transition-[grid-template-columns] lg:duration-200',
        collapsed ? 'lg:grid-cols-[4.5rem_1fr]' : 'lg:grid-cols-[15rem_1fr]',
      )}
    >
      <aside id="main-sidebar" className="border-line lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-r">
        <div
          className={clsx(
            'flex items-center justify-between gap-4 px-4 pt-4 lg:pt-6',
            collapsed ? 'lg:flex-col lg:gap-3 lg:px-0' : 'lg:px-5',
          )}
        >
          <Logo compact={collapsed} />
          <div className="flex items-center gap-2">
            {/* On small screens the settings live up here; the sidebar footer is hidden. */}
            <NavLink
              to={SETTINGS.to}
              aria-label={SETTINGS.label}
              title={SETTINGS.label}
              className={({ isActive }) => clsx(iconButtonClass, 'lg:hidden', isActive && 'bg-card text-ink')}
            >
              <Settings className="size-4" aria-hidden />
            </NavLink>
            {/* On large screens the theme toggle sits in the sidebar footer. */}
            <ThemeToggle className="lg:hidden" />
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              aria-controls="main-sidebar"
              aria-expanded={!collapsed}
              aria-label={collapsed ? 'Menü ausklappen' : 'Menü einklappen'}
              title={collapsed ? 'Menü ausklappen' : 'Menü einklappen'}
              className={clsx(iconButtonClass, 'hidden lg:grid')}
            >
              {collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
            </button>
          </div>
        </div>
        <nav aria-label="Hauptnavigation" className={clsx('mt-3 overflow-x-auto px-2 lg:mt-8', collapsed ? 'lg:px-0' : 'lg:px-3')}>
          <ul className={clsx('flex gap-1 lg:flex-col', collapsed && 'lg:items-center')}>
            {NAV.map((entry) =>
              isGroup(entry) ? (
                <li key={entry.id} className={clsx('flex gap-1 lg:flex-col', collapsed && 'lg:items-center')}>
                  <NavGroupEntry group={entry} compact={collapsed} />
                </li>
              ) : (
                <li key={entry.to}>
                  <NavEntry item={entry} compact={collapsed} />
                </li>
              ),
            )}
          </ul>
        </nav>
        <div className={clsx('hidden pb-4 lg:mt-auto', collapsed ? 'lg:flex lg:flex-col lg:items-center lg:gap-2' : 'space-y-3 px-3 lg:block')}>
          {collapsed ? (
            <>
              <NavEntry item={SETTINGS} compact />
              <ServerCard compact />
              <ThemeToggle />
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <NavEntry item={SETTINGS} compact={false} />
                </div>
                <ThemeToggle />
              </div>
              <ServerCard compact={false} />
            </>
          )}
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <RestartNotices />
        {children}
      </main>
    </div>
  );
}

function Logo({ compact }: { compact: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="size-8" />
      <span className={clsx('text-brand text-xl font-bold tracking-tight', compact && 'lg:sr-only')}>Manelly</span>
    </div>
  );
}

const entryClass = (compact: boolean) =>
  clsx('flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm', compact && 'lg:size-10 lg:justify-center lg:px-0');
const activeClass = 'bg-card font-medium text-ink shadow-sm ring-1 ring-line';
const idleClass = 'text-ink-2 hover:bg-card/60 hover:text-ink';

function NavEntry({ item, compact }: { item: NavItem; compact: boolean }) {
  const Icon = item.icon;
  // In the rail the label stays readable for screen readers and shows as a tooltip.
  const label = <span className={clsx(compact && 'lg:sr-only')}>{item.label}</span>;
  return (
    <NavLink to={item.to} end title={compact ? item.label : undefined} className={({ isActive }) => clsx(entryClass(compact), isActive ? activeClass : idleClass)}>
      <Icon className="size-4 shrink-0" aria-hidden />
      {label}
    </NavLink>
  );
}

/** The heading opens and closes its entries; closed, it shows when one of them is the current page. */
function NavGroupEntry({ group, compact }: { group: NavGroup; compact: boolean }) {
  // Closed after every load; closed, the heading shows when one of its pages is open.
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const current = group.children.some((child) => pathname === child.to || pathname.startsWith(`${child.to}/`));
  const Icon = group.icon;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`nav-${group.id}`}
        onClick={() => setOpen(!open)}
        title={compact ? `${group.label} – ${open ? 'zuklappen' : 'aufklappen'}` : undefined}
        className={clsx(entryClass(compact), 'lg:w-full', current && !open ? activeClass : current ? 'font-medium text-ink hover:bg-card/60' : idleClass)}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className={clsx(compact && 'lg:sr-only')}>{group.label}</span>
        <ChevronDown className={clsx('size-4 shrink-0 text-ink-3 transition lg:ml-auto', !open && '-rotate-90', compact && 'lg:hidden')} aria-hidden />
      </button>
      <ul
        id={`nav-${group.id}`}
        className={clsx(open ? 'flex' : 'hidden', 'gap-1 lg:flex-col', compact ? 'lg:items-center' : 'lg:ml-[1.125rem] lg:border-l lg:border-line lg:pl-2')}
      >
        {group.children.map((child) => (
          <li key={child.to}>
            <NavEntry item={child} compact={compact} />
          </li>
        ))}
      </ul>
    </>
  );
}

function ServerCard({ compact }: { compact: boolean }) {
  const { data: settings } = useSettings();
  const configured = settings ? isConfigured(settings) : undefined;
  const { data, error } = useServerStatus(configured === true);
  const shownError = useStickyError(error, data !== undefined);
  const state = configured === false ? 'unconfigured' : shownError ? 'error' : data ? 'ok' : 'pending';
  const name = STATE_LABELS[state] ?? data?.name;

  const dot = (
    <span
      aria-hidden
      className={clsx(
        'size-2 shrink-0 rounded-full',
        state === 'ok' && 'bg-good shadow-[0_0_0_3px] shadow-good/20',
        state === 'error' && 'bg-critical shadow-[0_0_0_3px] shadow-critical/20',
        state === 'unconfigured' && 'bg-ink-3',
        state === 'pending' && 'animate-pulse bg-ink-3',
      )}
    />
  );

  if (compact) {
    const details = data ? `${name} · Jellyfin ${data.version}` : name;
    return (
      <Link
        to="/settings"
        title={`${details} – Verbindung bearbeiten`}
        aria-label={`${details} – Verbindung bearbeiten`}
        className="grid size-10 place-items-center rounded-lg border border-line bg-card transition hover:border-accent/40"
      >
        {dot}
      </Link>
    );
  }

  return (
    <Link
      to="/settings"
      title="Verbindung bearbeiten"
      className="block rounded-xl border border-line bg-card p-3 text-sm transition hover:border-accent/40"
    >
      <div className="flex items-center gap-2">
        {dot}
        <span className="truncate font-medium">{name}</span>
      </div>
      {data && (
        <>
          <p className="mt-1 truncate text-xs text-ink-2" title={data.url}>
            Jellyfin {data.version}
            {data.operatingSystem && ` · ${data.operatingSystem}`}
          </p>
          {(data.hasUpdateAvailable || data.hasPendingRestart) && (
            <p className="mt-2 rounded-md bg-warning/12 px-2 py-1 text-xs ring-1 ring-warning/25 ring-inset">
              {data.hasPendingRestart ? 'Neustart ausstehend' : 'Update verfügbar'}
            </p>
          )}
        </>
      )}
    </Link>
  );
}

const STATE_LABELS: Partial<Record<string, string>> = {
  unconfigured: 'Noch nicht eingerichtet',
  error: 'Nicht verbunden',
  pending: 'Verbinde …',
};

const iconButtonClass =
  'grid size-9 place-items-center rounded-lg text-ink-2 ring-1 ring-line transition hover:bg-card hover:text-ink';

const THEME_ORDER: Theme[] = ['system', 'light', 'dark'];
const THEME_META: Record<Theme, { icon: LucideIcon; label: string }> = {
  system: { icon: Monitor, label: 'Design: System' },
  light: { icon: Sun, label: 'Design: Hell' },
  dark: { icon: Moon, label: 'Design: Dunkel' },
};

function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length] ?? 'system';
  const { icon: Icon, label } = THEME_META[theme];
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={`${label} – klicken zum Wechseln`}
      aria-label={label}
      className={clsx(iconButtonClass, className)}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
