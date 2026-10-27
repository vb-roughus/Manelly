import { describe, expect, it } from 'vitest';
import type { AgentStatus } from '@manelly/shared';
import { isAgentQuery, restartProgress, restartSummary, RESTART_TIMEOUT_MS, UPDATE_TIMEOUT_MS, type PendingRestart } from './agentRestart';

const status = (pid: number, startedAt: string, version = '0.10.0', lastUpdate: { at: string; ok: boolean; message: string } | null = null) =>
  ({ version, process: { pid, startedAt, lastUpdate } }) as unknown as AgentStatus;

const before = status(100, '2026-10-27T10:00:00Z', '0.9.0', { at: '2026-10-20T08:00:00Z', ok: true, message: 'Aktualisiert von a1 auf b2.' });
const pending = (update: boolean): PendingRestart => ({ update, before, since: 1_000_000 });

describe('restartProgress', () => {
  it('waits while the old process still answers or none does', () => {
    expect(restartProgress(pending(false), before, 1_005_000)).toBe('waiting');
    expect(restartProgress(pending(false), null, 1_005_000)).toBe('waiting');
  });

  it('is back once another process answers', () => {
    expect(restartProgress(pending(false), status(200, '2026-10-27T10:05:00Z'), 1_005_000)).toBe('back');
    // The same pid again, but started anew.
    expect(restartProgress(pending(false), status(100, '2026-10-27T10:05:00Z'), 1_005_000)).toBe('back');
  });

  it('gives up later on an update than on a plain restart', () => {
    const later = 1_000_000 + RESTART_TIMEOUT_MS + 1;
    expect(restartProgress(pending(false), null, later)).toBe('timeout');
    expect(restartProgress(pending(true), null, later)).toBe('waiting');
    expect(restartProgress(pending(true), null, 1_000_000 + UPDATE_TIMEOUT_MS + 1)).toBe('timeout');
  });
});

describe('restartSummary', () => {
  const finished = (update: boolean, after: AgentStatus | null) => ({ ...pending(update), after, ended: 1_000_000 + 125_000 });

  it('names the new process and version', () => {
    expect(restartSummary(finished(false, status(200, 'x', '0.9.0')))).toEqual({ ok: true, text: 'Neu gestartet. Version 0.9.0, Prozess 200.' });
  });

  it('takes the fresh update report, not the one from before', () => {
    const report = { at: '2026-10-27T10:04:00Z', ok: true, message: 'Aktualisiert von b2 auf c3.' };
    expect(restartSummary(finished(true, status(200, 'x', '0.10.0', report))).text).toBe('Aktualisiert von b2 auf c3. Neu gestartet: Version 0.9.0 → 0.10.0, Prozess 200.');
    expect(restartSummary(finished(true, status(200, 'x', '0.9.0', before.process!.lastUpdate))).text).toBe('Neu gestartet, ohne Bericht zum Update. Version 0.9.0, Prozess 200.');
  });

  it('fails on a failed update or when no process came back', () => {
    const report = { at: '2026-10-27T10:04:00Z', ok: false, message: 'git pull ist fehlgeschlagen. Der Agent startet mit der bisherigen Version.' };
    expect(restartSummary(finished(true, status(200, 'x', '0.9.0', report)))).toEqual({ ok: false, text: `Update fehlgeschlagen: ${report.message}` });
    const gone = restartSummary(finished(true, null));
    expect(gone.ok).toBe(false);
    expect(gone.text).toMatch(/nach 2 min nicht zurückgemeldet/);
  });
});

describe('isAgentQuery', () => {
  it('holds the queries that ask the agent, not the watcher or the settings', () => {
    expect(isAgentQuery(['agent', true])).toBe(true);
    expect(isAgentQuery(['jdownloader', 'links'])).toBe(true);
    expect(isAgentQuery(['history', 3600, null])).toBe(true);
    expect(isAgentQuery(['agent-restart'])).toBe(false);
    expect(isAgentQuery(['agent-settings'])).toBe(false);
    expect(isAgentQuery(['sessions'])).toBe(false);
  });
});
