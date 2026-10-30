import { useEffect, useState, type ReactNode } from 'react';
import type { AgentOverview, ConversionJob, ManellyStatus } from '@manelly/shared';
import { AppWindow, CloudDownload, RotateCw, ServerCog, TriangleAlert, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { useAgent, useAgentSettings, useConversions, useManelly, useRestartAgent, useRestartManelly } from '../hooks/queries';
import { agentRestart, useAgentRestart } from '../hooks/useAgentRestart';
import { manellyRestart, useManellyRestart } from '../hooks/useManellyRestart';
import { agentRestartSummary, updatesWhileRunning } from '../lib/agentRestart';
import { manellyRestartSummary } from '../lib/manellyRestart';
import { Code, Message } from './ConnectionForm';
import { runningJob } from './ConversionStatus';
import { AGENT, MANELLY, RestartProgress, RestartResult } from './Restart';

const button =
  'inline-flex items-center gap-2 rounded-lg bg-card px-4 py-2 text-sm font-medium text-ink ring-1 ring-line transition hover:bg-card-2 disabled:cursor-wait disabled:opacity-60';
const primaryButton =
  'bg-brand inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50';

/** A restart or update that waits for a «trotzdem», because a conversion runs: of the agent alone, or of everything. */
interface Asked {
  what: 'agent' | 'all';
  update: boolean;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-2">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Restarting and updating Manelly and the agent – each alone, or both at once with «Alles aktualisieren». Each updates
 * itself (git pull, build, restart) side by side; their progress outlasts Manelly's own restart and the reload after it.
 */
export function UpdatesPanel() {
  const manelly = useManelly();
  const agentSettings = useAgentSettings();
  const agentConfigured = Boolean(agentSettings.data?.url);
  const agent = useAgent({ enabled: agentConfigured });
  const restartManelly = useRestartManelly();
  const restartAgent = useRestartAgent();
  const manellyState = useManellyRestart();
  const agentState = useAgentRestart();
  const manellyStatus = manelly.data;
  const agentStatus = agent.data?.status ?? null;
  // A paused conversion stays paused over a restart; only a running one is interrupted.
  const busy = useConversions(Boolean(agentStatus)).data?.find((job) => job.state === 'running' && !job.paused) ?? null;
  const [asked, setAsked] = useState<Asked | null>(null);

  // An update started elsewhere, e.g. in another browser, shows here too.
  useEffect(() => {
    if (manellyStatus?.update) manellyRestart.adopt(manellyStatus, manellyStatus.update);
  }, [manellyStatus]);
  useEffect(() => {
    const running = agentStatus?.process?.update;
    if (running && agentStatus) agentRestart.adopt(agentStatus, running);
  }, [agentStatus]);

  const canManelly = Boolean(manellyStatus?.restartable) && !manellyState.pending;
  const canAgent = agentConfigured && Boolean(agentStatus?.process?.restartable) && !agentState.pending;
  const sending = restartManelly.isPending || restartAgent.isPending;

  function start(next: Asked, force = false) {
    if (busy && (next.what === 'agent' || canAgent) && !force) return setAsked(next);
    setAsked(null);
    if (next.what === 'agent' || canAgent) {
      if (agentStatus) restartAgent.mutate({ update: next.update, force, before: agentStatus });
    }
    if (next.what === 'all' && canManelly && manellyStatus) restartManelly.mutate({ update: true, before: manellyStatus });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <button type="button" onClick={() => start({ what: 'all', update: true })} disabled={!(canManelly || canAgent) || sending} className={primaryButton}>
          <CloudDownload className="size-4" aria-hidden /> Alles aktualisieren
        </button>
        <p className="text-xs text-ink-3">
          Manelly{agentConfigured ? ' und der Agent suchen' : ' sucht'} eine neuere Version; gibt es eine, holen sie sie mit <Code>git pull</Code>, bauen sich,
          während sie weiterlaufen, und starten erst danach neu{agentConfigured ? ' – beide gleichzeitig' : ''}. Was schon aktuell ist, bleibt, wie es ist; klappt
          etwas nicht, läuft die bisherige Version weiter.
        </p>
      </div>

      {asked && busy && (
        <BusyQuestion
          job={busy}
          asked={asked}
          pending={sending}
          onConfirm={() => start(asked, true)}
          onCancel={() => setAsked(null)}
        />
      )}

      <Part icon={AppWindow} title="Manelly">
        <ManellyPart status={manellyStatus} error={manelly.error?.message ?? null} restart={restartManelly} sending={sending} />
      </Part>
      {agentConfigured && (
        <Part icon={ServerCog} title="Agent">
          <AgentPart overview={agent.data} error={agent.error?.message ?? null} restart={restartAgent} sending={sending} onRestart={(update) => start({ what: 'agent', update })} />
        </Part>
      )}
    </div>
  );
}

/** Manelly's version and last update; restarting or updating it through its start script. */
function ManellyPart({
  status,
  error,
  restart,
  sending,
}: {
  status: ManellyStatus | undefined;
  error: string | null;
  restart: ReturnType<typeof useRestartManelly>;
  sending: boolean;
}) {
  const { pending, finished } = useManellyRestart();
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
  if (!status) return error ? <Message tone="critical">{error}</Message> : <div aria-busy className="h-24 animate-pulse rounded-xl bg-card-2" />;
  const windows = status.platform === 'win32';
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <Row label="Stand">{status.commit ? <Code>{status.commit}</Code> : 'unbekannt (kein git-Ordner)'}</Row>
        {/* Right after an update, the result below says the same. */}
        {status.lastUpdate && !finished?.update && (
          <Row label="Letztes Update">
            <span className={clsx(!status.lastUpdate.ok && 'text-critical')}>
              {when(status.lastUpdate.at)} · {status.lastUpdate.message}
            </span>
          </Row>
        )}
      </dl>
      {finished && <RestartResult summary={manellyRestartSummary(finished)} />}
      {status.restartable ? (
        <RestartButtons onRestart={(update) => restart.mutate({ update, before: status })} sending={sending} />
      ) : status.docker ? (
        <p className="text-xs text-ink-2">
          Manelly läuft in Docker und wird dort aktualisiert: auf dem Rechner mit dem Container <Code>git pull</Code> und{' '}
          <Code>docker compose up -d --build</Code>.
        </p>
      ) : (
        <p className="text-xs text-ink-2">
          Neu starten und Aktualisieren gehen hier, sobald Manelly über sein Start-Skript läuft: Manelly einmal beenden (Ctrl+C), dann <Code>git pull</Code> und{' '}
          <Code>{windows ? 'scripts\\start-windows.cmd' : './scripts/start-mac.sh'}</Code> starten.
        </p>
      )}
      {restart.isError && <p className="text-sm text-critical">{restart.error.message}</p>}
    </div>
  );
}

/** The agent's version and last update; restarting or updating it on the Jellyfin server. */
function AgentPart({
  overview,
  error,
  restart,
  sending,
  onRestart,
}: {
  overview: AgentOverview | undefined;
  error: string | null;
  restart: ReturnType<typeof useRestartAgent>;
  sending: boolean;
  onRestart: (update: boolean) => void;
}) {
  const { pending, finished } = useAgentRestart();
  if (pending) {
    return (
      <RestartProgress
        pending={pending}
        subject={AGENT}
        slowHint="Dauert es zu lange, steht in agent\data\agent.log auf dem Server, woran es hängt."
        onGiveUp={() => agentRestart.end(null)}
      />
    );
  }
  if (!overview) return error ? <Message tone="critical">{error}</Message> : <div aria-busy className="h-24 animate-pulse rounded-xl bg-card-2" />;
  const status = overview.status;
  if (!status) {
    return (
      <div className="space-y-3">
        {finished && <RestartResult summary={agentRestartSummary(finished)} />}
        <Message tone="critical">{overview.error ?? 'Der Agent antwortet nicht.'} Läuft er auf dem Jellyfin-Server?</Message>
      </div>
    );
  }
  const process = status.process;
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <Row label="Version">
          {status.version} · {status.hostname}
        </Row>
        {process?.lastUpdate && !(finished?.update && finished.after) && (
          <Row label="Letztes Update">
            <span className={clsx(!process.lastUpdate.ok && 'text-critical')}>
              {when(process.lastUpdate.at)} · {process.lastUpdate.message}
            </span>
          </Row>
        )}
      </dl>
      {finished && <RestartResult summary={agentRestartSummary(finished)} />}
      {process?.restartable ? (
        <>
          <RestartButtons onRestart={onRestart} sending={sending} />
          <p className="text-xs text-ink-3">
            {updatesWhileRunning(status)
              ? 'Der Agent holt die neue Version auf den Jellyfin-Server und baut sich, während er weiterläuft.'
              : 'Der Agent holt die neue Version auf den Jellyfin-Server, baut sich und startet neu.'}{' '}
            Läuft gerade eine Umwandlung, fragt Manelly vorher nach.
          </p>
        </>
      ) : (
        <p className="text-xs text-ink-2">
          Neu starten und Aktualisieren gehen hier, sobald der Agent über <Code>scripts\run-agent.ps1</Code> läuft: einmal <Code>git pull</Code> und{' '}
          <Code>scripts\start-agent.cmd -Install</Code> als Administrator ausführen.
        </p>
      )}
      {restart.isError && <p className="text-sm text-critical">{restart.error.message}</p>}
    </div>
  );
}

function Part({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-5">
      <h3 className="mb-3 flex items-center gap-2 font-medium">
        <Icon className="size-4 text-accent" aria-hidden /> {title}
      </h3>
      {children}
    </section>
  );
}

/** A conversion runs: restarting the agent interrupts it, so first a «trotzdem». */
function BusyQuestion({ job, asked, pending, onConfirm, onCancel }: { job: ConversionJob; asked: Asked; pending: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="space-y-3 rounded-xl bg-warning/10 p-4 ring-1 ring-warning/30 ring-inset">
      <p className="flex gap-2 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <span>
          <b className="font-semibold">Gerade läuft eine Umwandlung:</b> {runningJob(job)}. {asked.update ? 'Das Update startet den Agent neu und unterbricht' : 'Ein Neustart unterbricht'} sie.
          Danach macht sie weiter – eine Kopie dort, wo sie war, ein anderer Schritt von vorne. Am besten wartest du, bis sie fertig ist.
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={pending} onClick={onConfirm} className={button}>
          {asked.update ? <CloudDownload className="size-4" aria-hidden /> : <RotateCw className="size-4" aria-hidden />}
          {asked.what === 'all' ? 'Trotzdem alles aktualisieren' : asked.update ? 'Trotzdem aktualisieren' : 'Trotzdem neu starten'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-ink-2 hover:text-ink">
          Abbrechen
        </button>
      </div>
    </div>
  );
}

function RestartButtons({ onRestart, sending }: { onRestart: (update: boolean) => void; sending: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={sending} onClick={() => onRestart(false)} className={button}>
        <RotateCw className="size-4" aria-hidden /> Neu starten
      </button>
      <button type="button" disabled={sending} onClick={() => onRestart(true)} className={button}>
        <CloudDownload className="size-4" aria-hidden /> Aktualisieren & neu starten
      </button>
    </div>
  );
}
