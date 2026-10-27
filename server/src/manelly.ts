import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type { AgentUpdateResult, ManellyStatus, UpdateProgress } from '@manelly/shared';
import { createUpdater } from './updater.js';

/** The start scripts start Manelly again when it ends with this code; the same as the agent's. */
export const RESTART_EXIT = 75;

/** Manelly's own process: what runs, an update under way, and ending it so the start script starts it again. */
export interface ManellyProcess {
  status(): Promise<ManellyStatus>;
  /** Ends the server; the start script starts it again. */
  restart(): void;
  /** Looks for a newer version, pulls and builds while Manelly keeps running, then restarts – only if there was one. */
  update(): UpdateProgress;
}

/** The commit HEAD points to, read from .git without running git; null outside a plain checkout. */
export async function readCommit(root: string): Promise<string | null> {
  try {
    const head = (await readFile(join(root, '.git', 'HEAD'), 'utf8')).trim();
    if (!head.startsWith('ref: ')) return /^[0-9a-f]{7,}$/.test(head) ? head.slice(0, 7) : null;
    const ref = head.slice(5);
    const loose = await readFile(join(root, '.git', ...ref.split('/')), 'utf8').catch(() => null);
    if (loose) return loose.trim().slice(0, 7);
    // After git gc the branch lives in packed-refs only.
    const packed = await readFile(join(root, '.git', 'packed-refs'), 'utf8');
    const line = packed.split('\n').find((entry) => entry.trim().endsWith(` ${ref}`));
    return line ? line.slice(0, 7) : null;
  } catch {
    return null;
  }
}

/** What the start script wrote about its last update. */
export async function readUpdateReport(file: string | null): Promise<AgentUpdateResult | null> {
  if (!file) return null;
  try {
    const stored = JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, '')) as Partial<AgentUpdateResult>;
    if (typeof stored.at !== 'string' || typeof stored.ok !== 'boolean') return null;
    return { at: stored.at, ok: stored.ok, upToDate: stored.upToDate === true, from: stored.from ?? null, to: stored.to ?? null, message: String(stored.message ?? '') };
  } catch {
    return null;
  }
}

export async function createManellyProcess(options: {
  root: string;
  dataDir: string;
  port: number;
  env?: NodeJS.ProcessEnv;
  /** Ends the process with the code; closing the server first is up to the caller. */
  onExit: (code: number) => void;
  log: (message: string) => void;
  /** scripts/update.mjs, or a stand-in in tests. */
  updateScript?: string;
}): Promise<ManellyProcess> {
  const env = options.env ?? process.env;
  // Read once: a git pull without a restart does not change what runs.
  const commit = await readCommit(options.root);
  const info = {
    commit,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    hostname: hostname(),
    port: options.port,
    // Set by the start scripts, which start Manelly again.
    restartable: env.MANELLY_SUPERVISED === '1',
    docker: existsSync('/.dockerenv'),
  };
  const reportFile = join(options.dataDir, 'update.json');
  const restart = () => options.onExit(RESTART_EXIT);
  const updater = createUpdater({ script: options.updateScript ?? join(options.root, 'scripts', 'update.mjs'), reportFile, onRestart: restart, log: options.log });
  return {
    status: async () => ({ ...info, update: updater.progress(), lastUpdate: await readUpdateReport(reportFile) }),
    restart,
    update: () => updater.start(),
  };
}
