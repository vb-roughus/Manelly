// Updates this Manelly checkout while Manelly or the agent keeps running, step by step:
// look for a newer version (git fetch), git pull, npm ci when package-lock.json changed, and the build.
// Manelly and the agent run it when asked to update, report its steps, and restart once it succeeded.
//
//   node scripts/update.mjs <report.json> [agent]
//
// With "agent" only the agent is built, otherwise everything. Every step goes to stdout as a line of JSON:
//   {"event":"step","step":"check"}
//   {"event":"checked","current":"c76436b","latest":"24b94a1","behind":3,"subject":"…"}
//   {"event":"step","step":"pull"} … {"event":"step","step":"install"} … {"event":"step","step":"build"}
//   {"event":"done","ok":true,"upToDate":false,"from":"c76436b","to":"24b94a1","message":"…"}
// The done line also goes to the report file, where Manelly and the agent read it after the restart.
// Nothing changes when there is nothing new; whatever fails, the running version keeps running.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const reportFile = process.argv[2] ? resolve(process.argv[2]) : null;
const agentOnly = process.argv[3] === 'agent';
const windows = process.platform === 'win32';

// Synchronous, so every line arrives while the next step still runs.
const emit = (event) => writeSync(1, `${JSON.stringify(event)}\n`);

/** git from the PATH, or where Git for Windows installs it: the agent's autostart may run without the PATH. */
function findGit() {
  if (!windows) return 'git';
  const candidates = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map((folder) => join(folder, 'Git', 'cmd', 'git.exe'));
  return candidates.find((candidate) => existsSync(candidate)) ?? 'git';
}

/** npm next to the node that runs this script, so it is the same Node.js installation. */
function findNpm() {
  const nextToNode = join(dirname(process.execPath), windows ? 'npm.cmd' : 'npm');
  return existsSync(nextToNode) ? nextToNode : windows ? 'npm.cmd' : 'npm';
}

/** Output of a tool; it fails on its exit code, not on what it writes to stderr. */
function run(name, command, args) {
  // Windows runs .cmd files only through a shell, and the shell needs the path quoted.
  const shell = windows && /\.cmd$/i.test(command);
  const result = spawnSync(shell ? `"${command}"` : command, args, { cwd: root, encoding: 'utf8', shell, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`${name} liess sich nicht starten: ${result.error.message}`);
  if (result.status !== 0) {
    // git, npm, Vite and esbuild name the problem on lines with fatal:, error or [ERROR]; otherwise the last lines
    // say it. npm's echo of the script (lines starting with >) says nothing.
    const lines = `${result.stdout}\n${result.stderr}`
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('hint:') && !line.startsWith('>'));
    const named = lines.filter((line) => /^(fatal|error|npm (ERR!|error))|\[ERROR\]/i.test(line));
    const detail = (named.length ? named : lines).slice(-3).join(' / ') || 'ohne weitere Meldung';
    throw new Error(`${name} ist fehlgeschlagen (Exit-Code ${result.status}): ${detail}.`.replace(/\.\.$/, '.'));
  }
  return result.stdout.trim();
}

const git = findGit();
const npm = findNpm();
const report = { at: new Date().toISOString(), ok: false, upToDate: false, from: null, to: null, message: '' };
let pulled = false;
try {
  emit({ event: 'step', step: 'check' });
  report.from = run('git rev-parse', git, ['rev-parse', '--short', 'HEAD']);
  run('git fetch', git, ['fetch', '--quiet']);
  const latest = run('git rev-parse', git, ['rev-parse', '--short', '@{upstream}']);
  const behind = Number(run('git rev-list', git, ['rev-list', '--count', 'HEAD..@{upstream}']));
  const subject = behind > 0 ? run('git log', git, ['log', '-1', '--format=%s', '@{upstream}']) : null;
  emit({ event: 'checked', current: report.from, latest, behind, subject });

  if (behind === 0) {
    report.ok = true;
    report.upToDate = true;
    report.to = report.from;
    report.message = `Schon auf dem neuesten Stand (${report.from}).`;
  } else {
    emit({ event: 'step', step: 'pull' });
    run('git pull', git, ['merge', '--ff-only', '@{upstream}']);
    pulled = true;
    report.to = run('git rev-parse', git, ['rev-parse', '--short', 'HEAD']);
    // npm records the installed state in node_modules/.package-lock.json.
    const installed = join(root, 'node_modules', '.package-lock.json');
    if (!existsSync(installed) || statSync(join(root, 'package-lock.json')).mtimeMs > statSync(installed).mtimeMs) {
      emit({ event: 'step', step: 'install' });
      run('npm ci', npm, ['ci', '--no-audit', '--no-fund']);
    }
    emit({ event: 'step', step: 'build' });
    run('Der Build', npm, agentOnly ? ['run', 'build', '-w', 'agent'] : ['run', 'build']);
    report.ok = true;
    report.message = `Aktualisiert von ${report.from} auf ${report.to}.`;
  }
} catch (error) {
  let reason = error.message;
  if (/fast-forward|diverged/i.test(reason)) reason += ' Im Manelly-Ordner gibt es eigene Änderungen – dort «git status» prüfen.';
  if (/upstream/i.test(reason) && !pulled) reason += ' Der Manelly-Ordner folgt keinem Zweig auf GitHub – mit «git clone» neu holen.';
  report.message = pulled
    ? `${reason} Es läuft weiter die bisherige Version; der nächste Start nimmt, was zuletzt gebaut wurde. Nach dem Beheben erneut aktualisieren.`
    : `${reason} Es läuft weiter die bisherige Version.`;
}
emit({ event: 'done', ...report });
if (reportFile) {
  try {
    mkdirSync(dirname(reportFile), { recursive: true });
    writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  } catch {
    // The done line above still tells the caller.
  }
}
