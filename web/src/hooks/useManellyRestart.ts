import { onlineManager } from '@tanstack/react-query';
import type { ManellyStatus } from '@manelly/shared';
import { restartsNow } from '../lib/restart';
import { createRestartStore, useRestartState } from './restartStore';

/** Manelly's own restart, asked for under Server → Allgemein. */
export const manellyRestart = createRestartStore<ManellyStatus>('manelly.self.restart');

export const useManellyRestart = () => useRestartState(manellyRestart);

/** Manelly is away or about to go; while it only looks for news, pulls and builds, it still answers. */
export const manellyAway = (): boolean => {
  const { pending } = manellyRestart.get();
  return pending !== null && restartsNow(pending);
};

// While Manelly restarts, every query counts as offline: it keeps what it has and waits instead of failing,
// and asks again once Manelly is back. Otherwise TanStack Query's own rule: online unless the browser says not.
let browserOnline = true;
onlineManager.setEventListener((setOnline) => {
  const update = () => setOnline(browserOnline && !manellyAway());
  const online = () => {
    browserOnline = true;
    update();
  };
  const offline = () => {
    browserOnline = false;
    update();
  };
  window.addEventListener('online', online);
  window.addEventListener('offline', offline);
  const unsubscribe = manellyRestart.subscribe(update);
  update();
  return () => {
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
    unsubscribe();
  };
});
