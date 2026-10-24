import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import {
  LayoutDashboard,
  Library,
  Monitor,
  Moon,
  Server,
  Settings,
  Stethoscope,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { isConfigured, useServerStatus, useSettings } from '../hooks/queries';
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
  { to: '/media', label: 'Medien', icon: Library, soon: true },
  { to: '/server', label: 'Server', icon: Server, soon: true },
  { to: '/troubleshooting', label: 'Troubleshooting', icon: Stethoscope, soon: true },
];

const SETTINGS: NavItem = { to: '/settings', label: 'Einstellungen', icon: Settings };

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="border-line lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-r">
        <div className="flex items-center justify-between gap-4 px-4 pt-4 lg:px-5 lg:pt-6">
          <Logo />
          <div className="flex items-center gap-2">
            {/* On small screens the settings live up here; the sidebar footer is hidden. */}
            <NavLink
              to={SETTINGS.to}
              aria-label={SETTINGS.label}
              title={SETTINGS.label}
              className={({ isActive }) =>
                clsx(iconButtonClass, 'lg:hidden', isActive && 'bg-card text-ink')
              }
            >
              <Settings className="size-4" aria-hidden />
            </NavLink>
            <ThemeToggle />
          </div>
        </div>
        <nav aria-label="Hauptnavigation" className="mt-3 overflow-x-auto px-2 lg:mt-8 lg:px-3">
          <ul className="flex gap-1 lg:flex-col">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavEntry item={item} />
              </li>
            ))}
          </ul>
        </nav>
        <div className="hidden space-y-3 px-3 pb-4 lg:mt-auto lg:block">
          <NavEntry item={SETTINGS} />
          <ServerCard />
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">{children}</main>
    </div>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="size-8" />
      <span className="text-brand text-xl font-bold tracking-tight">Manelly</span>
    </div>
  );
}

function NavEntry({ item }: { item: NavItem }) {
  const Icon = item.icon;
  const base = 'flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm';
  if (item.soon) {
    return (
      <span aria-disabled className={clsx(base, 'cursor-not-allowed text-ink-3')}>
        <Icon className="size-4" aria-hidden />
        {item.label}
        <span className="ml-auto hidden rounded-full bg-card-2 px-1.5 py-0.5 text-[0.625rem] font-medium tracking-wide uppercase ring-1 ring-line lg:inline">
          Bald
        </span>
      </span>
    );
  }
  return (
    <NavLink
      to={item.to}
      end
      className={({ isActive }) =>
        clsx(base, isActive ? 'bg-card font-medium text-ink shadow-sm ring-1 ring-line' : 'text-ink-2 hover:bg-card/60 hover:text-ink')
      }
    >
      <Icon className="size-4" aria-hidden />
      {item.label}
    </NavLink>
  );
}

function ServerCard() {
  const { data: settings } = useSettings();
  const configured = settings ? isConfigured(settings) : undefined;
  const { data, error } = useServerStatus(configured === true);
  const shownError = useStickyError(error, data !== undefined);
  const state = configured === false ? 'unconfigured' : shownError ? 'error' : data ? 'ok' : 'pending';

  return (
    <Link
      to="/settings"
      title="Verbindung bearbeiten"
      className="block rounded-xl border border-line bg-card p-3 text-sm transition hover:border-accent/40"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={clsx(
            'size-2 rounded-full',
            state === 'ok' && 'bg-good shadow-[0_0_0_3px] shadow-good/20',
            state === 'error' && 'bg-critical shadow-[0_0_0_3px] shadow-critical/20',
            state === 'unconfigured' && 'bg-ink-3',
            state === 'pending' && 'animate-pulse bg-ink-3',
          )}
        />
        <span className="truncate font-medium">
          {STATE_LABELS[state] ?? data?.name}
        </span>
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

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length] ?? 'system';
  const { icon: Icon, label } = THEME_META[theme];
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={`${label} – klicken zum Wechseln`}
      aria-label={label}
      className={iconButtonClass}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
