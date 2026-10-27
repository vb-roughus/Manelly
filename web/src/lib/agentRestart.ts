import type { AgentStatus } from '@manelly/shared';
import { formatSpan } from './timeline';

/** A restart under way: what ran before, to tell the new process and the new update report apart. */
export interface PendingRestart {
  update: boolean;
  before: AgentStatus;
  /** When it was asked for, in ms. */
  since: number;
}

/** How it ended: the new process, or null when none answered in time or nobody waited any longer. */
export interface FinishedRestart extends PendingRestart {
  after: AgentStatus | null;
  /** In ms. */
  ended: number;
}

/** A plain restart takes seconds; an update runs git pull, maybe npm ci, and a build. */
export const RESTART_TIMEOUT_MS = 2 * 60_000;
export const UPDATE_TIMEOUT_MS = 10 * 60_000;

export const restartDeadline = (pending: PendingRestart): number => pending.since + (pending.update ? UPDATE_TIMEOUT_MS : RESTART_TIMEOUT_MS);

/** Back once a process with another pid or start time answers; given up after the deadline. */
export function restartProgress(pending: PendingRestart, status: AgentStatus | null | undefined, now: number): 'waiting' | 'back' | 'timeout' {
  const before = pending.before.process;
  const after = status?.process;
  if (after && (after.pid !== before?.pid || after.startedAt !== before?.startedAt)) return 'back';
  return now > restartDeadline(pending) ? 'timeout' : 'waiting';
}

/** What the restart brought, in a sentence: the new process and, with an update, its report. */
export function restartSummary({ update, before, after, since, ended }: FinishedRestart): { ok: boolean; text: string } {
  if (!after) {
    return {
      ok: false,
      text: `Der Agent hat sich nach ${formatSpan(ended - since)} nicht zurückgemeldet. In agent\\data\\agent.log auf dem Server steht, woran es hängt.`,
    };
  }
  const report = after.process?.lastUpdate;
  const fresh = report && report.at !== before.process?.lastUpdate?.at ? report : null;
  if (update && fresh && !fresh.ok) return { ok: false, text: `Update fehlgeschlagen: ${fresh.message}` };
  const version = before.version === after.version ? `Version ${after.version}` : `Version ${before.version} → ${after.version}`;
  const what = !update ? 'Neu gestartet.' : fresh ? `${fresh.message} Neu gestartet:` : 'Neu gestartet, ohne Bericht zum Update.';
  return { ok: true, text: `${what} ${version}, Prozess ${after.process?.pid}.` };
}

/** The queries that ask the agent; they hold still while it restarts, so its absence shows no errors. */
const AGENT_QUERIES = new Set(['agent', 'conversions', 'conversion-options', 'network', 'network-interfaces', 'resources', 'jdownloader', 'linkgrabber', 'history']);

export const isAgentQuery = (queryKey: readonly unknown[]): boolean => typeof queryKey[0] === 'string' && AGENT_QUERIES.has(queryKey[0]);
