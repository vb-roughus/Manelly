import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useManelly } from '../hooks/queries';
import { useManellyRestart } from '../hooks/useManellyRestart';
import { formatSpan } from '../lib/timeline';
import { Code, Message } from './ConnectionForm';

const PLATFORMS: Record<string, string> = { win32: 'Windows', linux: 'Linux', darwin: 'macOS' };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-2">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

/** Manelly's own server: what runs; restarting and updating it are under Einstellungen → Updates. */
export function ManellyProcess() {
  const manelly = useManelly();
  const { pending } = useManellyRestart();
  const status = manelly.data;

  // The notice on top of the page tells how it goes.
  if (pending) return <p className="text-sm text-ink-2">Manelly startet gerade neu oder wird aktualisiert.</p>;
  if (!status) {
    return manelly.error ? <Message tone="critical">{manelly.error.message}</Message> : <div aria-busy className="h-32 animate-pulse rounded-xl bg-card-2" />;
  }

  const windows = status.platform === 'win32';
  const startedBy = status.restartable
    ? windows
      ? 'über scripts\\start-windows.cmd'
      : 'über scripts/start-mac.sh'
    : status.docker
      ? 'in Docker'
      : 'von Hand, ohne Start-Skript';
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <Row label="Stand">{status.commit ? <Code>{status.commit}</Code> : 'unbekannt (kein git-Ordner)'}</Row>
        <Row label="Rechner">
          {status.hostname} · {PLATFORMS[status.platform] ?? status.platform}
        </Row>
        <Row label="Prozess">
          node · PID <b className="font-semibold tabular-nums">{status.pid}</b> · Port {status.port}
        </Row>
        <Row label="Läuft seit">
          {new Date(status.startedAt).toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' })} ({formatSpan(Date.now() - Date.parse(status.startedAt))})
        </Row>
        <Row label="Gestartet">{startedBy}</Row>
        <Row label="Node.js">{status.node}</Row>
        {status.lastUpdate && (
          <Row label="Letztes Update">
            <span className={status.lastUpdate.ok ? undefined : 'text-critical'}>
              {new Date(status.lastUpdate.at).toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' })} · {status.lastUpdate.message}
            </span>
          </Row>
        )}
      </dl>
      <p className="text-xs text-ink-3">
        Neu starten und aktualisieren – Manelly und den Agent auch beide auf einmal – unter{' '}
        <Link to="/settings" className="font-medium text-accent hover:underline">
          Einstellungen → Updates
        </Link>
        .
      </p>
    </div>
  );
}
