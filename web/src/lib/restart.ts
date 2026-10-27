import type { AgentUpdateResult, UpdateProgress } from '@manelly/shared';

/** A restart or update under way – of the agent or of Manelly: what ran before, and what is known since. */
export interface PendingRestart<S> {
  update: boolean;
  before: S;
  /** When it was asked for, in ms. */
  since: number;
  /** The update's last step as the process reported it; null for a plain restart, or an agent that updates while stopped. */
  progress: UpdateProgress | null;
  /** The process stopped answering: it restarts. */
  away: boolean;
  /**
   * When the process itself said the update began, by its own clock. Only a report from after that ends an update
   * without restart; an answer still on its way from before must not.
   */
  startedAt: string | null;
}

/** How it ended: the process that answered last, or null when none answered in time or nobody waited any longer. */
export interface FinishedRestart<S> extends PendingRestart<S> {
  after: S | null;
  /** In ms. */
  ended: number;
}

/** What tells two runs of a process apart. */
export interface ProcessIdentity {
  pid: number;
  startedAt: string;
}

/** Where a status says which process answers, which update it runs and how the last one went. */
export interface ProcessView<S> {
  identity: (status: S) => ProcessIdentity | null | undefined;
  update: (status: S) => UpdateProgress | null | undefined;
  report: (status: S) => AgentUpdateResult | null | undefined;
}

/** A plain restart takes seconds; an update looks for news, pulls, maybe installs, and builds. */
export const RESTART_TIMEOUT_MS = 2 * 60_000;
export const UPDATE_TIMEOUT_MS = 10 * 60_000;

export const restartDeadline = (pending: PendingRestart<unknown>): number => pending.since + (pending.update ? UPDATE_TIMEOUT_MS : RESTART_TIMEOUT_MS);

/**
 * Whether the process is away or about to go: from then on its queries hold still instead of failing. An update
 * keeps the process answering while it looks for news, pulls and builds.
 */
export const restartsNow = (pending: PendingRestart<unknown>): boolean => pending.away || pending.progress === null || pending.progress.step === 'restart';

/**
 * Back once a process with another pid or start time answers; settled when the same process finished its update
 * without restarting (nothing new, or it failed); given up after the deadline.
 */
export function restartProgress<S>(pending: PendingRestart<S>, current: S | null | undefined, view: ProcessView<S>, now: number): 'waiting' | 'back' | 'settled' | 'timeout' {
  const before = view.identity(pending.before);
  const after = current ? view.identity(current) : null;
  if (after && (after.pid !== before?.pid || after.startedAt !== before?.startedAt)) return 'back';
  const report = current ? view.report(current) : null;
  if (current && pending.startedAt && !view.update(current) && report && Date.parse(report.at) >= Date.parse(pending.startedAt)) return 'settled';
  return now > restartDeadline(pending) ? 'timeout' : 'waiting';
}

/**
 * The report this update brought: written after the process said the update began, or else unlike the one from
 * before; null while the process still shows an older one.
 */
export function freshReport(
  pending: Pick<PendingRestart<unknown>, 'startedAt'>,
  before: AgentUpdateResult | null | undefined,
  after: AgentUpdateResult | null | undefined,
): AgentUpdateResult | null {
  if (!after) return null;
  if (pending.startedAt) return Date.parse(after.at) >= Date.parse(pending.startedAt) ? after : null;
  return after.at !== before?.at ? after : null;
}

/** The first step of an update that runs while the process keeps answering. */
export const firstUpdateStep = (): UpdateProgress => ({ step: 'check', steps: ['check'], since: new Date().toISOString(), behind: null, subject: null });
