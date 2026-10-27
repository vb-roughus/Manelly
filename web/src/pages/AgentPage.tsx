import { useEffect, useState, type ReactNode } from 'react';
import type { AgentOverview, AgentStatus } from '@manelly/shared';
import { Activity, LoaderCircle, Plug, Power } from 'lucide-react';
import { AgentForm } from '../components/AgentForm';
import { Code, Message } from '../components/ConnectionForm';
import { SettingsSection } from '../components/SettingsSection';
import { useAgent, useAgentSettings, useStopAgent } from '../hooks/queries';
import { formatSpan } from '../lib/timeline';

const PLATFORMS: Record<string, string> = { win32: 'Windows', linux: 'Linux', darwin: 'macOS' };

export function AgentPage() {
  useEffect(() => {
    document.title = 'Agent · Manelly';
  }, []);
  const settings = useAgentSettings();
  // The same query as the connection form above.
  const overview = useAgent({ refreshTools: true, enabled: Boolean(settings.data?.url) });

  return (
    <div className="mx-auto max-w-3xl">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Agent</h1>
        <p className="mt-1 text-sm text-ink-2">
          Der Manelly-Agent läuft auf dem Jellyfin-Server: Er wandelt Dateien um, misst die Auslastung, zeichnet auf und steuert JDownloader.
        </p>
      </header>

      <SettingsSection icon={Plug} title="Verbindung" description="Adresse und Schlüssel des Agents. Manelly prüft beides, bevor es speichert.">
        <AgentForm />
      </SettingsSection>

      {settings.data?.url && overview.data && (
        <SettingsSection icon={Activity} title="Prozess" description="Wo der Agent läuft, seit wann – und ihn beenden, z. B. vor einem Update.">
          <ProcessPanel overview={overview.data} agentUrl={settings.data.url} />
        </SettingsSection>
      )}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-2">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

const portOf = (url: string) => {
  try {
    return new URL(url).port || '8790';
  } catch {
    return '8790';
  }
};

function ProcessPanel({ overview, agentUrl }: { overview: AgentOverview; agentUrl: string }) {
  const stop = useStopAgent();
  const [confirming, setConfirming] = useState(false);
  // What was running when it was stopped; afterwards the agent no longer answers.
  const [stopped, setStopped] = useState<AgentStatus | null>(null);
  const status = overview.status;

  if (stopped) return <Stopped status={stopped} />;
  if (!status) {
    return <Message tone="critical">{overview.error ?? 'Der Agent antwortet nicht.'} Läuft er auf dem Jellyfin-Server?</Message>;
  }

  const windows = status.platform === 'win32';
  const process = status.process;
  const executable = process?.execPath.split(/[\\/]/).pop() ?? 'node';
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <Detail label="Version">{status.version}</Detail>
        <Detail label="Rechner">
          {status.hostname} · {PLATFORMS[status.platform] ?? status.platform}
        </Detail>
        {process && (
          <>
            <Detail label="Prozess">
              {executable} · PID <b className="font-semibold tabular-nums">{process.pid}</b> · Port {process.port}
            </Detail>
            <Detail label="Läuft seit">
              {new Date(process.startedAt).toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' })} ({formatSpan(Date.now() - Date.parse(process.startedAt))})
            </Detail>
            <Detail label="Gestartet">{process.autostart ? 'vom Autostart' : 'von Hand, in einem Fenster'}</Detail>
            <Detail label="Node.js">{process.node}</Detail>
          </>
        )}
      </dl>

      {process && windows && (
        <p className="text-xs text-ink-2">
          Der Agent ist kein Dienst: Im Task-Manager steht er unter «Details» als <Code>{executable}</Code> mit der PID {process.pid}
          {process.autostart && <>, gestartet von der Aufgabe «Manelly Agent» in der Aufgabenplanung</>}.
        </p>
      )}

      {process ? (
        confirming ? (
          <div className="space-y-3 rounded-xl bg-critical/8 p-4 ring-1 ring-critical/25 ring-inset">
            <p className="text-sm">
              <b className="font-semibold">Agent beenden?</b> Eine laufende Umwandlung hält an und macht beim nächsten Start weiter. Bis dahin ruhen Aufzeichnung,
              Messungen und das Bremsen von JDownloader.
            </p>
            {stop.isError && <p className="text-sm text-critical">{stop.error.message}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={stop.isPending}
                onClick={() => stop.mutate(undefined, { onSuccess: () => setStopped(status) })}
                className="inline-flex items-center gap-2 rounded-lg bg-critical px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
              >
                {stop.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Power className="size-4" aria-hidden />}
                Agent beenden
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="text-sm text-ink-2 hover:text-ink">
                Abbrechen
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-card px-4 py-2 text-sm font-medium text-critical ring-1 ring-line transition hover:bg-critical/8"
          >
            <Power className="size-4" aria-hidden /> Agent beenden …
          </button>
        )
      ) : (
        <Message tone="info">
          <p>
            Version {status.version} kann sich noch nicht selbst beenden. Auf dem Jellyfin-Server <Code>git pull</Code> und{' '}
            <Code>{windows ? 'scripts\\start-agent.cmd -Install' : 'npm run build -w agent'}</Code>
            {windows && ' als Administrator ausführen – das beendet den alten Agent und startet den neuen'}.
          </p>
          <p className="mt-2">{windows ? 'Klappt das nicht, in einer PowerShell als Administrator:' : 'Beenden von Hand:'}</p>
          <pre className="mt-1 rounded-md bg-card px-2 py-1.5 font-mono text-xs break-all whitespace-pre-wrap ring-1 ring-line ring-inset">
            {windows
              ? `Get-NetTCPConnection -LocalPort ${portOf(agentUrl)} -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`
              : `kill $(lsof -t -i :${portOf(agentUrl)} -s TCP:LISTEN)`}
          </pre>
        </Message>
      )}
    </div>
  );
}

/** How to get it running again, the way it was started. */
function Stopped({ status }: { status: AgentStatus }) {
  const windows = status.platform === 'win32';
  return (
    <Message tone="good">
      <p>Der Agent auf {status.hostname} ist beendet.</p>
      <p className="mt-1">
        Wieder starten:{' '}
        {windows && status.process?.autostart ? (
          <>
            Windows neu starten, oder auf dem Server in einer PowerShell als Administrator <Code>Start-ScheduledTask -TaskName 'Manelly Agent'</Code>. Nach
            einem <Code>git pull</Code> stattdessen <Code>scripts\start-agent.cmd -Install</Code>.
          </>
        ) : windows ? (
          <>
            <Code>scripts\start-agent.cmd</Code> auf dem Server.
          </>
        ) : (
          <>so, wie du ihn gestartet hast.</>
        )}
      </p>
    </Message>
  );
}
