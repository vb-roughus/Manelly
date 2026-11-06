import type { UpdateProgress, UpdateStep } from '@manelly/shared';
import { Circle, CircleCheck, CircleMinus, LoaderCircle, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { useWatchAgentRestart, useWatchManellyRestart } from '../hooks/queries';
import { useNow } from '../hooks/useNow';
import { agentRestart, useAgentRestart } from '../hooks/useAgentRestart';
import { manellyRestart, useManellyRestart } from '../hooks/useManellyRestart';
import { agentRestartSummary } from '../lib/agentRestart';
import { manellyRestartSummary } from '../lib/manellyRestart';
import { restartsNow, type PendingRestart } from '../lib/restart';
import { Message } from './ConnectionForm';
import type { AppNotification } from './Notifications';

/** Where restarts and updates are asked for, and followed in detail. */
const UPDATES_PAGE = '/settings';

/** Who restarts, for the sentences: «Der Agent startet neu», «baut den Agent». */
export interface RestartSubject {
  name: string;
  object: string;
}

export const AGENT: RestartSubject = { name: 'Der Agent', object: 'den Agent' };
export const MANELLY: RestartSubject = { name: 'Manelly', object: 'Manelly' };

const STEPS: UpdateStep[] = ['check', 'pull', 'install', 'build', 'restart'];
type StepState = 'done' | 'current' | 'next' | 'skipped';

const STEP_ICONS: Record<StepState, { icon: LucideIcon; tone: string }> = {
  done: { icon: CircleCheck, tone: 'text-good' },
  current: { icon: LoaderCircle, tone: 'animate-spin text-accent' },
  next: { icon: Circle, tone: 'text-ink-3' },
  skipped: { icon: CircleMinus, tone: 'text-ink-3' },
};

function stepLabel(step: UpdateStep, state: StepState, progress: UpdateProgress, away: boolean, subject: RestartSubject): string {
  switch (step) {
    case 'check':
      if (state !== 'done' || progress.behind === null) return 'Sucht eine neuere Version (git fetch)';
      return `${progress.behind === 1 ? '1 neue Änderung' : `${progress.behind} neue Änderungen`} gefunden${progress.subject ? `, zuletzt «${progress.subject}»` : ''}`;
    case 'pull':
      return 'Holt die Änderungen (git pull)';
    case 'install':
      return state === 'skipped' ? 'Abhängigkeiten unverändert' : 'Installiert die Abhängigkeiten (npm ci)';
    case 'build':
      return `Baut ${subject.object}`;
    case 'restart':
      return state === 'current' && away ? 'Startet neu – antwortet gerade nicht' : 'Startet neu';
  }
}

/** The steps of an update, as far as the process reported them; the restart once it no longer answers. */
function UpdateSteps({ progress, away, subject }: { progress: UpdateProgress; away: boolean; subject: RestartSubject }) {
  const current = STEPS.indexOf(away ? 'restart' : progress.step);
  return (
    <ol className="space-y-1">
      {STEPS.map((step, index) => {
        const state: StepState =
          index < current ? (step === 'install' && !progress.steps.includes('install') ? 'skipped' : 'done') : index === current ? 'current' : 'next';
        const { icon: Icon, tone } = STEP_ICONS[state];
        return (
          <li key={step} className={clsx('flex items-start gap-2', state === 'current' ? 'font-medium' : state === 'done' ? 'text-ink-2' : 'text-ink-3')}>
            <Icon className={clsx('mt-0.5 size-4 shrink-0', tone)} aria-hidden />
            <span className="min-w-0 break-words">
              {stepLabel(step, state, progress, away, subject)}
              {state === 'current' && ' …'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** While the agent or Manelly restarts or updates: how long, every step known so far, and a way to stop waiting. */
export function RestartProgress({
  pending,
  subject,
  slowHint,
  onGiveUp,
}: {
  pending: PendingRestart<unknown>;
  subject: RestartSubject;
  /** Shown once it takes more than three minutes. */
  slowHint: string;
  onGiveUp: () => void;
}) {
  const now = useNow(1000);
  const seconds = Math.max(0, Math.round((now - pending.since) / 1000));
  const title = !pending.update ? `${subject.name} startet neu …` : pending.progress ? `Aktualisiert ${subject.object} …` : `Aktualisiert ${subject.object} und startet neu …`;
  return (
    <div role="status" className="space-y-2 rounded-lg bg-card-2 px-4 py-3 text-sm ring-1 ring-line ring-inset">
      <p className="flex items-center gap-2 font-medium">
        {!pending.progress && <LoaderCircle className="size-4 animate-spin text-accent" aria-hidden />}
        {title}
        <span className="font-normal text-ink-3 tabular-nums">{seconds} s</span>
      </p>
      {pending.progress ? (
        <UpdateSteps progress={pending.progress} away={pending.away} subject={subject} />
      ) : (
        <p className="text-ink-2">
          {pending.update
            ? 'git pull, falls nötig npm ci, dann der Build – das kann eine Minute dauern, mit neuen Abhängigkeiten auch länger.'
            : 'Das dauert meist nur ein paar Sekunden.'}
        </p>
      )}
      {seconds > 180 && <p className="text-ink-2">{slowHint}</p>}
      {/* Waiting ends by itself too, after a few minutes; this is for whoever knows better. */}
      <button type="button" onClick={onGiveUp} className="text-xs font-medium text-accent hover:underline">
        Nicht mehr warten
      </button>
    </div>
  );
}

/** What a restart brought, as a message on the page that asked for it. */
export function RestartResult({ summary }: { summary: { ok: boolean; text: string } }) {
  return <Message tone={summary.ok ? 'good' : 'critical'}>{summary.text}</Message>;
}

/** In a few words, for the bell. */
function pendingText(pending: PendingRestart<unknown>, subject: RestartSubject): { title: string; detail: string } {
  if (!pending.update) return { title: `${subject.name} startet neu …`, detail: 'Bis dahin bleibt der letzte Stand stehen.' };
  if (restartsNow(pending)) return { title: `${subject.name} wird aktualisiert und startet neu …`, detail: 'Bis dahin bleibt der letzte Stand stehen.' };
  const step = pending.progress?.step;
  const detail = step === 'check' ? 'Sucht eine neuere Version.' : step === 'pull' ? 'Holt die Änderungen.' : step === 'install' ? 'Installiert die Abhängigkeiten.' : `Baut ${subject.object}.`;
  return { title: `${subject.name} wird aktualisiert …`, detail };
}

/** Follows restarts and updates of the agent and of Manelly from any page; mounted once, in the layout. */
export function RestartWatcher() {
  useWatchAgentRestart();
  useWatchManellyRestart();
  return null;
}

/** Restarts and updates under way, and how the last ones ended, for the bell. */
export function useRestartNotifications(): AppNotification[] {
  const manelly = useManellyRestart();
  const agent = useAgentRestart();
  const link = { to: UPDATES_PAGE, label: 'Zu den Updates' };
  const entries: AppNotification[] = [];
  for (const [key, label, subject, state, summary, dismiss] of [
    ['manelly', 'Manelly', MANELLY, manelly, manelly.finished && manellyRestartSummary(manelly.finished), manellyRestart.dismiss],
    ['agent', 'Agent', AGENT, agent, agent.finished && agentRestartSummary(agent.finished), agentRestart.dismiss],
  ] as const) {
    if (state.pending) {
      const { title, detail } = pendingText(state.pending, subject);
      entries.push({ id: `${key}-pending-${state.pending.since}`, tone: 'progress', title, text: detail, link });
    } else if (state.finished && summary) {
      entries.push({ id: `${key}-${state.finished.ended}`, tone: summary.ok ? 'good' : 'critical', title: label, text: summary.text, link, at: state.finished.ended, onDismiss: dismiss });
    }
  }
  return entries;
}
