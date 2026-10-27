import { useSyncExternalStore } from 'react';
import type { AgentStatus } from '@manelly/shared';
import type { FinishedRestart, PendingRestart } from '../lib/agentRestart';

export interface AgentRestartState {
  pending: PendingRestart | null;
  finished: FinishedRestart | null;
}

// Kept for the tab, so a reload during the restart still waits instead of showing errors, and still tells how it ended.
const STORAGE_KEY = 'manelly.agent.restart';
const NOTHING: AgentRestartState = { pending: null, finished: null };
let state: AgentRestartState = load();
const listeners = new Set<() => void>();

function load(): AgentRestartState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? { ...NOTHING, ...(JSON.parse(raw) as Partial<AgentRestartState>) } : NOTHING;
  } catch {
    return NOTHING;
  }
}

function setState(next: AgentRestartState) {
  state = next;
  try {
    if (next.pending || next.finished) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Without storage a reload only forgets the restart.
  }
  for (const listener of listeners) listener();
}

/** The one agent restart of this tab, for every page: under way, or how the last one ended. */
export const agentRestart = {
  begin: (update: boolean, before: AgentStatus) => setState({ pending: { update, before, since: Date.now() }, finished: null }),
  /** `after` null: no new process answered. */
  end: (after: AgentStatus | null) => {
    if (state.pending) setState({ pending: null, finished: { ...state.pending, after, ended: Date.now() } });
  },
  /** The request itself failed: nothing restarts, and its own error says why. */
  abandon: () => setState(NOTHING),
  dismiss: () => setState({ ...state, finished: null }),
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAgentRestart(): AgentRestartState {
  return useSyncExternalStore(subscribe, () => state);
}
