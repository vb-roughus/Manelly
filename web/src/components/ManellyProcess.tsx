import { useEffect, type ReactNode } from 'react';
import { CloudDownload, RotateCw } from 'lucide-react';
import { useManelly, useRestartManelly } from '../hooks/queries';
import { manellyRestart, useManellyRestart } from '../hooks/useManellyRestart';
import { manellyRestartSummary } from '../lib/manellyRestart';
import { formatSpan } from '../lib/timeline';
import { Code, Message } from './ConnectionForm';
import { MANELLY, RestartProgress, RestartResult } from './Restart';

const PLATFORMS: Record<string, string> = { win32: 'Windows', linux: 'Linux', darwin: 'macOS' };

const actionButton =
  'inline-flex items-center gap-2 rounded-lg bg-card px-4 py-2 text-sm font-medium text-ink ring-1 ring-line transition hover:bg-card-2 disabled:cursor-wait disabled:opacity-60';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-2">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

/** Manelly's own server: what runs, and restarting or updating it through its start script. */
export function ManellyProcess() {
  const manelly = useManelly();
  const restart = useRestartManelly();
  const { pending, finished } = useManellyRestart();
  const status = manelly.data;

  // An update this page did not start, e.g. in another browser, shows here too.
  const running = status?.update;
  useEffect(() => {
    if (running && status) manellyRestart.adopt(status, running);
  }, [running, status]);

  if (pending) {
    return (
      <RestartProgress
        pending={pending}
        subject={MANELLY}
        slowHint="Dauert es zu lange, steht im Fenster des Start-Skripts, woran es hängt."
        onGiveUp={() => manellyRestart.end(null)}
      />
    );
  }
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
        {/* Right after an update, the result below says the same. */}
        {status.lastUpdate && !finished?.update && (
          <Row label="Letztes Update">
            <span className={status.lastUpdate.ok ? undefined : 'text-critical'}>
              {new Date(status.lastUpdate.at).toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' })} · {status.lastUpdate.message}
            </span>
          </Row>
        )}
      </dl>

      {finished && <RestartResult summary={manellyRestartSummary(finished)} />}

      {status.restartable ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={restart.isPending} onClick={() => restart.mutate({ update: false, before: status })} className={actionButton}>
              <RotateCw className="size-4" aria-hidden /> Neu starten
            </button>
            <button type="button" disabled={restart.isPending} onClick={() => restart.mutate({ update: true, before: status })} className={actionButton}>
              <CloudDownload className="size-4" aria-hidden /> Aktualisieren & neu starten
            </button>
          </div>
          <p className="text-xs text-ink-3">
            Aktualisieren sucht zuerst eine neuere Version; gibt es keine, bleibt alles, wie es ist. Sonst holt es sie mit <Code>git pull</Code>, installiert
            bei Bedarf die Abhängigkeiten und baut Manelly, während es weiterläuft, und startet erst danach neu – dann lädt auch diese Seite neu. Klappt
            etwas nicht, läuft die bisherige Version weiter.
          </p>
          {restart.isError && <p className="text-sm text-critical">{restart.error.message}</p>}
        </div>
      ) : status.docker ? (
        <p className="text-xs text-ink-2">
          Manelly läuft in Docker und wird dort aktualisiert: auf dem Rechner mit dem Container <Code>git pull</Code> und{' '}
          <Code>docker compose up -d --build</Code>.
        </p>
      ) : (
        <p className="text-xs text-ink-2">
          Neu starten und Aktualisieren gehen hier, sobald Manelly über sein Start-Skript läuft: Manelly einmal beenden (Ctrl+C), dann{' '}
          <Code>git pull</Code> und <Code>{windows ? 'scripts\\start-windows.cmd' : './scripts/start-mac.sh'}</Code> starten.
        </p>
      )}
    </div>
  );
}
