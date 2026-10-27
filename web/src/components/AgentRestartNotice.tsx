import { useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { CircleCheck, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import clsx from 'clsx';
import { useWatchAgentRestart } from '../hooks/queries';
import { agentRestart, useAgentRestart } from '../hooks/useAgentRestart';
import { restartSummary } from '../lib/agentRestart';

const AGENT_PAGE = '/server/agent';

/**
 * Watches a restart of the agent from any page. Away from the agent page it says that the agent restarts,
 * and afterwards how that went; the agent page tells it in more detail itself.
 */
export function AgentRestartNotice() {
  useWatchAgentRestart();
  const { pending, finished } = useAgentRestart();
  const onAgentPage = useLocation().pathname === AGENT_PAGE;
  const summary = finished ? restartSummary(finished) : null;
  const ok = summary?.ok ?? false;

  // A success says its piece and goes; a failure stays until it is closed.
  useEffect(() => {
    if (!ok || onAgentPage) return;
    const timer = window.setTimeout(agentRestart.dismiss, 15_000);
    return () => window.clearTimeout(timer);
  }, [ok, onAgentPage, finished]);

  if (onAgentPage) return null;
  if (pending) {
    return (
      <div role="status" className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-card-2 px-4 py-2.5 text-sm ring-1 ring-line ring-inset">
        <span className="flex items-center gap-2 font-medium">
          <LoaderCircle className="size-4 shrink-0 animate-spin text-accent" aria-hidden />
          {pending.update ? 'Der Agent wird aktualisiert und startet neu …' : 'Der Agent startet neu …'}
        </span>
        <span className="text-ink-2">Bis er zurück ist, bleibt der letzte Stand stehen.</span>
        <Link to={AGENT_PAGE} className="font-medium text-accent hover:underline sm:ml-auto">
          Zum Agent
        </Link>
      </div>
    );
  }
  if (!summary) return null;
  const Icon = ok ? CircleCheck : TriangleAlert;
  return (
    <div
      role={ok ? 'status' : 'alert'}
      className={clsx('mb-6 flex items-start gap-3 rounded-xl px-4 py-2.5 text-sm ring-1 ring-inset', ok ? 'bg-good/10 ring-good/25' : 'bg-critical/10 ring-critical/25')}
    >
      <Icon className={clsx('mt-0.5 size-4 shrink-0', ok ? 'text-good' : 'text-critical')} aria-hidden />
      <p className="min-w-0 flex-1 break-words">
        <b className="font-semibold">Agent:</b> {summary.text}{' '}
        <Link to={AGENT_PAGE} className="font-medium whitespace-nowrap text-accent hover:underline">
          Zum Agent
        </Link>
      </p>
      <button type="button" onClick={agentRestart.dismiss} aria-label="Hinweis schliessen" title="Schliessen" className="-mr-1 rounded-md p-0.5 text-ink-2 hover:text-ink">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
