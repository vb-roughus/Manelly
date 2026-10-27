import { describe, expect, it } from 'vitest';
import type { AgentStatus, AgentUpdateResult, ManellyStatus } from '@manelly/shared';
import { agentRestartProgress, agentRestartSummary, isAgentQuery } from './agentRestart';
import { manellyRestartProgress, manellyRestartSummary } from './manellyRestart';
import { restartsNow, RESTART_TIMEOUT_MS, UPDATE_TIMEOUT_MS, type PendingRestart } from './restart';

const report = (at: string, ok: boolean, message: string): AgentUpdateResult => ({ at, ok, from: null, to: null, message });
const agent = (pid: number, startedAt: string, version = '0.10.0', lastUpdate: AgentUpdateResult | null = null) =>
  ({ version, process: { pid, startedAt, lastUpdate } }) as unknown as AgentStatus;

const before = agent(100, '2026-10-27T10:00:00Z', '0.9.0', report('2026-10-20T08:00:00Z', true, 'Aktualisiert von a1 auf b2.'));
const pending = (update: boolean): PendingRestart<AgentStatus> => ({ update, before, since: 1_000_000, progress: null, away: false, startedAt: null });

describe('agentRestartProgress', () => {
  it('waits while the old process still answers or none does', () => {
    expect(agentRestartProgress(pending(false), before, 1_005_000)).toBe('waiting');
    expect(agentRestartProgress(pending(false), null, 1_005_000)).toBe('waiting');
  });

  it('is back once another process answers', () => {
    expect(agentRestartProgress(pending(false), agent(200, '2026-10-27T10:05:00Z'), 1_005_000)).toBe('back');
    // The same pid again, but started anew.
    expect(agentRestartProgress(pending(false), agent(100, '2026-10-27T10:05:00Z'), 1_005_000)).toBe('back');
  });

  it('gives up later on an update than on a plain restart', () => {
    const later = 1_000_000 + RESTART_TIMEOUT_MS + 1;
    expect(agentRestartProgress(pending(false), null, later)).toBe('timeout');
    expect(agentRestartProgress(pending(true), null, later)).toBe('waiting');
    expect(agentRestartProgress(pending(true), null, 1_000_000 + UPDATE_TIMEOUT_MS + 1)).toBe('timeout');
  });
});

describe('agentRestartSummary', () => {
  const finished = (update: boolean, after: AgentStatus | null) => ({ ...pending(update), after, ended: 1_000_000 + 125_000 });

  it('names the new process and version', () => {
    expect(agentRestartSummary(finished(false, agent(200, 'x', '0.9.0')))).toEqual({ ok: true, text: 'Neu gestartet. Version 0.9.0, Prozess 200.' });
  });

  it('takes the fresh update report, not the one from before', () => {
    const fresh = report('2026-10-27T10:04:00Z', true, 'Aktualisiert von b2 auf c3.');
    expect(agentRestartSummary(finished(true, agent(200, 'x', '0.10.0', fresh))).text).toBe('Aktualisiert von b2 auf c3. Neu gestartet: Version 0.9.0 → 0.10.0, Prozess 200.');
    expect(agentRestartSummary(finished(true, agent(200, 'x', '0.9.0', before.process!.lastUpdate))).text).toBe('Neu gestartet, ohne Bericht zum Update. Version 0.9.0, Prozess 200.');
  });

  it('fails on a failed update or when no process came back', () => {
    const failed = report('2026-10-27T10:04:00Z', false, 'git pull ist fehlgeschlagen. Der Agent startet mit der bisherigen Version.');
    expect(agentRestartSummary(finished(true, agent(200, 'x', '0.9.0', failed)))).toEqual({ ok: false, text: `Update fehlgeschlagen: ${failed.message}` });
    const gone = agentRestartSummary(finished(true, null));
    expect(gone.ok).toBe(false);
    expect(gone.text).toMatch(/nach 2 min nicht zurückgemeldet/);
  });
});

describe('Manelly restart', () => {
  const manelly = (pid: number, startedAt: string, commit: string | null, lastUpdate: AgentUpdateResult | null = null) =>
    ({ pid, startedAt, commit, lastUpdate }) as ManellyStatus;
  const old = manelly(10, '2026-10-27T10:00:00Z', 'c76436b');
  const waiting = (update: boolean): PendingRestart<ManellyStatus> => ({ update, before: old, since: 1_000_000, progress: null, away: false, startedAt: null });

  it('is back once another server process answers', () => {
    expect(manellyRestartProgress(waiting(false), old, 1_001_000)).toBe('waiting');
    expect(manellyRestartProgress(waiting(false), manelly(11, '2026-10-27T10:01:00Z', 'c76436b'), 1_001_000)).toBe('back');
  });

  it('settles when the same process finished its update without restarting', () => {
    const building = { ...old, update: { step: 'build' as const, steps: ['check' as const, 'pull' as const, 'build' as const], since: 'x', behind: 2, subject: 'Neu' } };
    expect(manellyRestartProgress(waiting(true), building, 1_001_000)).toBe('waiting');
    // Still the report from before the update: the answer came before the update began.
    expect(manellyRestartProgress(waiting(true), { ...old, update: null }, 1_001_000)).toBe('waiting');
    const nothingNew = { ...old, update: null, lastUpdate: report('2026-10-27T10:01:00Z', true, 'Schon auf dem neuesten Stand (c76436b).') };
    // Not before Manelly itself said when the update began: the answer could be from before.
    expect(manellyRestartProgress(waiting(true), nothingNew, 1_001_000)).toBe('waiting');
    const started = { ...waiting(true), startedAt: '2026-10-27T10:00:30Z' };
    expect(manellyRestartProgress(started, nothingNew, 1_001_000)).toBe('settled');
    // A report from an earlier update does not end this one.
    expect(manellyRestartProgress({ ...waiting(true), startedAt: '2026-10-27T10:05:00Z' }, nothingNew, 1_001_000)).toBe('waiting');
    expect(manellyRestartSummary({ ...waiting(true), after: { ...nothingNew, lastUpdate: { ...nothingNew.lastUpdate, upToDate: true } }, ended: 1_002_000 })).toEqual({
      ok: true,
      text: 'Schon auf dem neuesten Stand (c76436b). Manelly läuft weiter, ohne Neustart.',
    });
  });

  it('holds the queries only once the process goes away', () => {
    const update = { step: 'build' as const, steps: ['check' as const, 'build' as const], since: 'x', behind: 1, subject: null };
    expect(restartsNow(waiting(false))).toBe(true);
    expect(restartsNow({ ...waiting(true), progress: update })).toBe(false);
    expect(restartsNow({ ...waiting(true), progress: { ...update, step: 'restart' } })).toBe(true);
    expect(restartsNow({ ...waiting(true), progress: update, away: true })).toBe(true);
  });

  it('tells the update report, or the commit after a plain restart', () => {
    const done = (update: boolean, after: ManellyStatus | null) => ({ ...waiting(update), after, ended: 1_030_000 });
    const updated = manelly(11, 'y', '24b94a1', report('2026-10-27T10:01:00Z', true, 'Aktualisiert von c76436b auf 24b94a1.'));
    expect(manellyRestartSummary(done(true, updated))).toEqual({ ok: true, text: 'Aktualisiert von c76436b auf 24b94a1. Neu gestartet, Prozess 11.' });
    expect(manellyRestartSummary(done(false, manelly(12, 'z', 'c76436b')))).toEqual({ ok: true, text: 'Neu gestartet. Stand c76436b, Prozess 12.' });
    const failed = manelly(13, 'z', 'c76436b', report('2026-10-27T10:01:00Z', false, 'Der Build ist fehlgeschlagen.'));
    expect(manellyRestartSummary(done(true, failed))).toEqual({ ok: false, text: 'Update fehlgeschlagen: Der Build ist fehlgeschlagen.' });
    expect(manellyRestartSummary(done(false, null)).text).toMatch(/^Manelly hat sich nach 30 s nicht zurückgemeldet/);
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
