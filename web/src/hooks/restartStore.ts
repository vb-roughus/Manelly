import { useSyncExternalStore } from 'react';
import type { UpdateProgress } from '@manelly/shared';
import type { FinishedRestart, PendingRestart } from '../lib/restart';

export interface RestartState<S> {
  pending: PendingRestart<S> | null;
  finished: FinishedRestart<S> | null;
}

/**
 * One restart at a time, for every page: under way, or how the last one ended. Kept for the tab, so a reload
 * in between still waits instead of showing errors, and still tells how it ended.
 */
export function createRestartStore<S>(storageKey: string) {
  const nothing: RestartState<S> = { pending: null, finished: null };
  const listeners = new Set<() => void>();
  let state = load();

  function load(): RestartState<S> {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw ? { ...nothing, ...(JSON.parse(raw) as Partial<RestartState<S>>) } : nothing;
    } catch {
      return nothing;
    }
  }

  function set(next: RestartState<S>) {
    state = next;
    try {
      if (next.pending || next.finished) sessionStorage.setItem(storageKey, JSON.stringify(next));
      else sessionStorage.removeItem(storageKey);
    } catch {
      // Without storage a reload only forgets the restart.
    }
    for (const listener of listeners) listener();
  }

  return {
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** `progress` is the first step of an update that runs while the process keeps answering. */
    begin: (update: boolean, before: S, progress: UpdateProgress | null = null) =>
      set({ pending: { update, before, since: Date.now(), progress, away: false, startedAt: null }, finished: null }),
    /** An update this tab did not ask for, e.g. from another browser, or before the page was opened. */
    adopt: (before: S, progress: UpdateProgress) => {
      if (state.pending) return;
      set({ pending: { update: true, before, since: Date.parse(progress.since) || Date.now(), progress, away: false, startedAt: progress.since }, finished: null });
    },
    /** What is known about the update, and whether the process still answers; `reported` comes from the process itself. */
    note: (progress: UpdateProgress | null, away: boolean, reported = false) => {
      const { pending } = state;
      if (!pending) return;
      const startedAt = pending.startedAt ?? (reported && progress ? progress.since : null);
      if (pending.away === away && pending.startedAt === startedAt && JSON.stringify(pending.progress) === JSON.stringify(progress)) return;
      set({ ...state, pending: { ...pending, progress, away, startedAt } });
    },
    /** `after` null: no new process answered. */
    end: (after: S | null) => {
      if (state.pending) set({ pending: null, finished: { ...state.pending, after, ended: Date.now() } });
    },
    /** The request itself failed: nothing restarts, and its own error says why. */
    abandon: () => set(nothing),
    dismiss: () => set({ ...state, finished: null }),
  };
}

export type RestartStore<S> = ReturnType<typeof createRestartStore<S>>;

export function useRestartState<S>(store: RestartStore<S>): RestartState<S> {
  return useSyncExternalStore(store.subscribe, store.get);
}
