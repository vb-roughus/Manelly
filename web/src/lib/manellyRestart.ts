import type { ManellyStatus } from '@manelly/shared';
import { freshReport, restartProgress, type FinishedRestart, type PendingRestart, type ProcessView } from './restart';
import { formatSpan } from './timeline';

export const manellyView: ProcessView<ManellyStatus> = {
  identity: (status) => status,
  update: (status) => status.update,
  report: (status) => status.lastUpdate,
};

export const manellyRestartProgress = (pending: PendingRestart<ManellyStatus>, status: ManellyStatus | null | undefined, now: number) =>
  restartProgress(pending, status, manellyView, now);

/** What the restart or update brought, in a sentence: the new process and, with an update, its report. */
export function manellyRestartSummary({ update, before, after, since, ended }: FinishedRestart<ManellyStatus>): { ok: boolean; text: string } {
  if (!after) {
    return {
      ok: false,
      text: `Manelly hat sich nach ${formatSpan(ended - since)} nicht zurückgemeldet. Im Fenster, in dem das Start-Skript läuft, steht, woran es hängt.`,
    };
  }
  const fresh = update ? freshReport(before.lastUpdate, after.lastUpdate) : null;
  if (fresh && !fresh.ok) return { ok: false, text: `Update fehlgeschlagen: ${fresh.message}` };
  if (fresh?.upToDate) return { ok: true, text: `${fresh.message} Manelly läuft weiter, ohne Neustart.` };
  if (fresh) return { ok: true, text: `${fresh.message} Neu gestartet, Prozess ${after.pid}.` };
  const what = update ? 'Neu gestartet, ohne Bericht zum Update.' : 'Neu gestartet.';
  return { ok: true, text: `${what} ${after.commit ? `Stand ${after.commit}, ` : ''}Prozess ${after.pid}.` };
}
