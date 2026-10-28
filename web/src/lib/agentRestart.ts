import type { AgentStatus } from '@manelly/shared';
import { freshReport, restartProgress, type FinishedRestart, type PendingRestart, type ProcessView } from './restart';
import { formatSpan } from './timeline';

export const agentView: ProcessView<AgentStatus> = {
  identity: (status) => status.process,
  update: (status) => status.process?.update,
  report: (status) => status.process?.lastUpdate,
};

export const agentRestartProgress = (pending: PendingRestart<AgentStatus>, status: AgentStatus | null | undefined, now: number) =>
  restartProgress(pending, status, agentView, now);

/** Agents from 0.11.0 update while they keep running, and say so in their status. */
export const updatesWhileRunning = (status: AgentStatus): boolean => status.process?.update !== undefined;

/** What the restart or update brought, in a sentence: the new process and, with an update, its report. */
export function agentRestartSummary(finished: FinishedRestart<AgentStatus>): { ok: boolean; text: string } {
  const { update, before, after, since, ended } = finished;
  if (!after) {
    return {
      ok: false,
      text: `Der Agent hat sich nach ${formatSpan(ended - since)} nicht zurückgemeldet. In agent\\data\\agent.log auf dem Server steht, woran es hängt.`,
    };
  }
  const fresh = update ? freshReport(finished, before.process?.lastUpdate, after.process?.lastUpdate) : null;
  if (fresh && !fresh.ok) return { ok: false, text: `Update fehlgeschlagen: ${fresh.message}` };
  if (fresh?.upToDate) return { ok: true, text: `${fresh.message} Der Agent läuft weiter, ohne Neustart (Version ${after.version}).` };
  const version = before.version === after.version ? `Version ${after.version}` : `Version ${before.version} → ${after.version}`;
  const what = !update ? 'Neu gestartet.' : fresh ? `${fresh.message} Neu gestartet:` : 'Neu gestartet, ohne Bericht zum Update.';
  return { ok: true, text: `${what} ${version}, Prozess ${after.process?.pid}.` };
}

/** The queries that ask the agent; they hold still while it restarts, so its absence shows no errors. */
const AGENT_QUERIES = new Set(['agent', 'conversions', 'conversion-options', 'network', 'network-interfaces', 'resources', 'jdownloader', 'linkgrabber', 'history', 'originals']);

export const isAgentQuery = (queryKey: readonly unknown[]): boolean => typeof queryKey[0] === 'string' && AGENT_QUERIES.has(queryKey[0]);
