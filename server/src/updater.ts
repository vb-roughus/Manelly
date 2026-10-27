import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import type { AgentUpdateResult, UpdateProgress, UpdateStep } from '@manelly/shared';

const STEP_LABELS: Record<UpdateStep, string> = {
  check: 'sucht eine neuere Version (git fetch) …',
  pull: 'holt die Änderungen (git pull) …',
  install: 'installiert die Abhängigkeiten (npm ci) …',
  build: 'baut …',
  restart: 'fertig, startet neu …',
};

export interface UpdaterOptions {
  /** scripts/update.mjs of this checkout. */
  script: string;
  /** Where the script writes its report, read back as the last update. */
  reportFile: string;
  /** Passed on to the script: build only the agent; Manelly builds everything. */
  target?: 'agent';
  /** Ends the process so its runner starts the new build. */
  onRestart: () => void;
  log: (message: string) => void;
  /** How long the restart step shows before the process ends, so Manelly sees it coming. */
  restartDelayMs?: number;
}

/**
 * Updates the checkout with scripts/update.mjs while this process keeps running and answering, step by step;
 * restarts only when there was something new and everything worked. Otherwise the running version stays.
 */
export function createUpdater({ script, reportFile, target, onRestart, log, restartDelayMs = 3000 }: UpdaterOptions) {
  let progress: UpdateProgress | null = null;

  function enter(step: UpdateStep) {
    if (!progress) return;
    progress = { ...progress, step, steps: [...progress.steps, step] };
    log(`Update: ${STEP_LABELS[step]}`);
  }

  /** When the script ends without its last line, the report says so instead. */
  function reportFailure(message: string) {
    const report: AgentUpdateResult = { at: new Date().toISOString(), ok: false, upToDate: false, from: null, to: null, message };
    try {
      mkdirSync(dirname(reportFile), { recursive: true });
      writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
    } catch {
      // The log still has it.
    }
    log(`Update: ${message}`);
  }

  return {
    progress: () => progress,

    /** Starts the update, or tells the one already under way. */
    start(): UpdateProgress {
      if (progress) return progress;
      progress = { step: 'check', steps: ['check'], since: new Date().toISOString(), behind: null, subject: null };
      log(`Update: ${STEP_LABELS.check}`);
      const child = spawn(process.execPath, [script, reportFile, ...(target ? [target] : [])], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let done = false;
      let errors = '';
      child.stderr.on('data', (chunk: Buffer) => {
        errors = (errors + chunk.toString()).slice(-2000);
      });
      createInterface({ input: child.stdout }).on('line', (line) => {
        let event: { event?: string; step?: UpdateStep; behind?: number; subject?: string | null; ok?: boolean; upToDate?: boolean; message?: string };
        try {
          event = JSON.parse(line) as typeof event;
        } catch {
          return;
        }
        if (event.event === 'step' && event.step && event.step !== 'check') enter(event.step);
        if (event.event === 'checked' && progress) progress = { ...progress, behind: event.behind ?? null, subject: event.subject ?? null };
        if (event.event === 'done') {
          done = true;
          log(`Update: ${event.message ?? ''}`);
          if (event.ok && !event.upToDate) {
            enter('restart');
            setTimeout(onRestart, restartDelayMs);
          } else {
            progress = null;
          }
        }
      });
      child.on('error', (error) => {
        if (done) return;
        done = true;
        progress = null;
        reportFailure(`Das Update liess sich nicht starten: ${error.message}`);
      });
      child.on('close', (code) => {
        if (done) return;
        done = true;
        progress = null;
        const detail = errors.trim().split('\n').filter(Boolean).slice(-2).join(' / ');
        reportFailure(`Das Update brach unerwartet ab (Exit-Code ${code})${detail ? `: ${detail}` : ''}. Es läuft weiter die bisherige Version.`);
      });
      return progress;
    },
  };
}

export type Updater = ReturnType<typeof createUpdater>;
