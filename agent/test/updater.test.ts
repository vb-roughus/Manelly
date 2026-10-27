import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentUpdateResult } from '@manelly/shared';
import { createUpdater } from '../src/updater.js';

/** A stand-in for scripts/update.mjs that prints the given lines, slowly, and ends with the exit code. */
async function fakeScript(lines: object[], exitCode = 0) {
  const dir = await mkdtemp(join(tmpdir(), 'updater-'));
  const script = join(dir, 'update.mjs');
  await writeFile(
    script,
    `const lines = ${JSON.stringify(lines.map((line) => JSON.stringify(line)))};
for (const line of lines) { process.stdout.write(line + '\\n'); await new Promise((r) => setTimeout(r, 30)); }
process.stderr.write('kaputt\\n');
process.exit(${exitCode});`,
  );
  return { script, reportFile: join(dir, 'update.json') };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
};

describe('updater', () => {
  it('reports its steps and restarts once something new is built', async () => {
    const files = await fakeScript([
      { event: 'step', step: 'check' },
      { event: 'checked', current: 'a1', latest: 'b2', behind: 3, subject: 'Neu' },
      { event: 'step', step: 'pull' },
      { event: 'step', step: 'build' },
      { event: 'done', ok: true, upToDate: false, message: 'Aktualisiert von a1 auf b2.' },
    ]);
    let restarted = 0;
    const logged: string[] = [];
    const updater = createUpdater({ ...files, onRestart: () => restarted++, log: (line) => logged.push(line), restartDelayMs: 20 });
    expect(updater.start()).toMatchObject({ step: 'check', steps: ['check'], behind: null });
    // A second request tells the update under way instead of starting another.
    expect(updater.start().since).toBe(updater.progress()!.since);
    await until(() => updater.progress()?.step === 'build');
    expect(updater.progress()).toMatchObject({ steps: ['check', 'pull', 'build'], behind: 3, subject: 'Neu' });
    await until(() => restarted > 0);
    expect(updater.progress()).toMatchObject({ step: 'restart', steps: ['check', 'pull', 'build', 'restart'] });
    expect(logged).toContain('Update: Aktualisiert von a1 auf b2.');
  });

  it('does not restart when there is nothing new or the update failed', async () => {
    for (const done of [
      { event: 'done', ok: true, upToDate: true, message: 'Schon auf dem neuesten Stand (a1).' },
      { event: 'done', ok: false, upToDate: false, message: 'Der Build ist fehlgeschlagen.' },
    ]) {
      const files = await fakeScript([{ event: 'step', step: 'check' }, done]);
      let restarted = 0;
      const updater = createUpdater({ ...files, onRestart: () => restarted++, log: () => {}, restartDelayMs: 0 });
      updater.start();
      await until(() => updater.progress() === null);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(restarted).toBe(0);
    }
  });

  it('writes the report itself when the script ends without its last line', async () => {
    const files = await fakeScript([{ event: 'step', step: 'check' }], 3);
    const updater = createUpdater({ ...files, onRestart: () => {}, log: () => {} });
    updater.start();
    await until(() => updater.progress() === null);
    const report = JSON.parse(await readFile(files.reportFile, 'utf8')) as AgentUpdateResult;
    expect(report).toMatchObject({ ok: false, upToDate: false });
    expect(report.message).toMatch(/Exit-Code 3\): kaputt\. Es läuft weiter die bisherige Version\./);
  });
});
