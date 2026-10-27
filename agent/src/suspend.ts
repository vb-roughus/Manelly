import { spawn } from 'node:child_process';
import { join } from 'node:path';

export type SuspendAction = 'suspend' | 'resume';

/** Holds a running process where it is, or lets it go on; rejects when the system does not allow it. */
export type Suspender = (pid: number, action: SuspendAction) => Promise<void>;

/** NtSuspendProcess holds every thread of the process, like SIGSTOP; Windows has no signal for it. */
const windowsScript = (pid: number, action: SuspendAction) => `
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Manelly -Name Process -MemberDefinition '
  [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr handle);
  [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr handle);'
$process = [System.Diagnostics.Process]::GetProcessById(${pid})
$status = [Manelly.Process]::Nt${action === 'suspend' ? 'Suspend' : 'Resume'}Process($process.Handle)
if ($status -ne 0) { throw "NTSTATUS $status" }
`;

function runPowerShell(script: string): Promise<void> {
  // The autostart may run without the PATH of an interactive session.
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 30_000,
    });
    let errors = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (errors += chunk));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(errors.trim().split(/\r?\n/)[0] || `PowerShell endete mit ${code}.`))));
  });
}

export const suspendProcess: Suspender = async (pid, action) => {
  if (process.platform === 'win32') return runPowerShell(windowsScript(pid, action));
  process.kill(pid, action === 'suspend' ? 'SIGSTOP' : 'SIGCONT');
};
