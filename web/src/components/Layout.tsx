import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import {
  LayoutDashboard,
  Library,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Server,
  Settings,
  Stethoscope,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { isConfigured, useServerStatus, useSettings } from '../hooks/queries';
import { usePersistentFlag } from '../hooks/usePersistentFlag';
import { useStickyError } from '../hooks/useStickyError';
import { useTheme, type Theme } from '../hooks/useTheme';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Not built yet; shown so the planned scope is visible. */
  soon?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/media', label: 'Medien', icon: Library },
  { to: '/server', label: 'Server', icon: Server, soon: true },
  { to: '/troubleshooting', label: 'Troubleshooting', icon: Stethoscope, soon: true },
];

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
            {NAV.map((item) => (
              <li key={item.to}>
                <NavEntry item={item} compact={collapsed} />
              </li>
            ))}
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
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">{children}</main>
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

function NavEntry({ item, compact }: { item: NavItem; compact: boolean }) {
  const Icon = item.icon;
  const base = clsx(
    'flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm',
    compact && 'lg:size-10 lg:justify-center lg:px-0',
  );
  // In the rail the label stays readable for screen readers and shows as a tooltip.
  const label = <span className={clsx(compact && 'lg:sr-only')}>{item.label}</span>;
  if (item.soon) {
    return (
      <span aria-disabled title={compact ? `${item.label} – bald verfügbar` : undefined} className={clsx(base, 'cursor-not-allowed text-ink-3')}>
        <Icon className="size-4 shrink-0" aria-hidden />
        {label}
        <span
          className={clsx(
            'ml-auto hidden rounded-full bg-card-2 px-1.5 py-0.5 text-[0.625rem] font-medium tracking-wide uppercase ring-1 ring-line',
            !compact && 'lg:inline',
          )}
        >
          Bald
        </span>
      </span>
    );
  }
  return (
    <NavLink
      to={item.to}
      end
      title={compact ? item.label : undefined}
      className={({ isActive }) =>
        clsx(base, isActive ? 'bg-card font-medium text-ink shadow-sm ring-1 ring-line' : 'text-ink-2 hover:bg-card/60 hover:text-ink')
      }
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {label}
    </NavLink>
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
