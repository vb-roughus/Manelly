import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { KeyRound, Plug, ServerCrash, Settings, TriangleAlert, type LucideIcon } from 'lucide-react';
import { ApiError, type ClientErrorCode } from '../lib/api';

interface Guide {
  icon: LucideIcon;
  title: string;
  steps: ReactNode[];
  /** Offer a shortcut to the connection settings. */
  settings?: boolean;
}

const GUIDES: Partial<Record<ClientErrorCode, Guide>> = {
  NOT_CONFIGURED: {
    icon: Plug,
    title: 'Jellyfin ist noch nicht verbunden',
    steps: [<>Trage die Adresse deines Jellyfin-Servers und einen API-Schlüssel in den Einstellungen ein.</>],
    settings: true,
  },
  UNAUTHORIZED: {
    icon: KeyRound,
    title: 'Jellyfin lehnt den API-Schlüssel ab',
    steps: [
      <>
        Prüfe unter <b>Dashboard → API-Schlüssel</b> in Jellyfin, ob der Schlüssel noch existiert, oder erstelle einen
        neuen.
      </>,
      <>Trage ihn in den Einstellungen ein.</>,
    ],
    settings: true,
  },
  UNREACHABLE: {
    icon: ServerCrash,
    title: 'Jellyfin ist nicht erreichbar',
    steps: [
      <>Läuft Jellyfin? Öffne die Weboberfläche von Jellyfin im Browser.</>,
      <>
        Stimmt die Server-Adresse in den Einstellungen? Sie muss vom Manelly-Server aus erreichbar sein. In Docker zeigt{' '}
        <Code>localhost</Code> auf den Container selbst – nutze die IP des Hosts oder den Container-Namen.
      </>,
    ],
    settings: true,
  },
  TIMEOUT: {
    icon: ServerCrash,
    title: 'Jellyfin antwortet nicht rechtzeitig',
    steps: [<>Jellyfin ist erreichbar, reagiert aber sehr langsam. Prüfe die Auslastung des Servers.</>],
  },
  UPSTREAM_ERROR: {
    icon: ServerCrash,
    title: 'Unerwartete Antwort von Jellyfin',
    steps: [<>Prüfe, ob die Server-Adresse in den Einstellungen wirklich auf Jellyfin zeigt (Port und Pfad).</>],
    settings: true,
  },
  NETWORK: {
    icon: ServerCrash,
    title: 'Der Manelly-Server antwortet nicht',
    steps: [<>Läuft der Manelly-Server noch? Prüfe die Logs des Prozesses oder Containers.</>],
  },
};

export function ErrorPanel({ error }: { error: unknown }) {
  const apiError = error instanceof ApiError ? error : null;
  const guide = apiError ? GUIDES[apiError.code] : undefined;
  const Icon = guide?.icon ?? TriangleAlert;

  return (
    <section className="mx-auto max-w-2xl rounded-2xl border border-line bg-card p-6 shadow-sm shadow-black/5" role="alert">
      <div className="flex items-start gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-critical/12 text-critical">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{guide?.title ?? 'Etwas ist schiefgelaufen'}</h2>
          <p className="mt-1 text-sm break-words text-ink-2">
            {error instanceof Error ? error.message : 'Unbekannter Fehler.'}
          </p>
        </div>
      </div>
      {guide && (
        <ol className="mt-5 space-y-3 text-sm">
          {guide.steps.map((step, index) => (
            <li key={index} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-card-2 text-xs font-semibold ring-1 ring-line">
                {index + 1}
              </span>
              <div className="min-w-0 pt-0.5">{step}</div>
            </li>
          ))}
        </ol>
      )}
      {guide?.settings && (
        <Link
          to="/settings"
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-card-2 px-3 py-2 text-sm font-medium ring-1 ring-line transition hover:bg-card hover:ring-accent/40"
        >
          <Settings className="size-4" aria-hidden />
          Verbindung bearbeiten
        </Link>
      )}
    </section>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-card-2 px-1 py-0.5 text-[0.8125rem] ring-1 ring-line ring-inset">{children}</code>;
}
