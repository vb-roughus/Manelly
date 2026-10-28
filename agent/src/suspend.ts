import { spawn } from 'node:child_process';
import { defaultPowershell, scriptArgs, scriptError } from './powershell.js';

export type SuspendAction = 'suspend' | 'resume';

/** Holds a running process where it is, or lets it go on; rejects when the system does not allow it. */
export type Suspender = (pid: number, action: SuspendAction) => Promise<void>;

/** NtSuspendProcess holds every thread of the process, like SIGSTOP; Windows has no signal for it. */
const windowsScript = (pid: number, action: SuspendAction) => `
Add-Type -Namespace Manelly -Name Process -MemberDefinition '
  [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr handle);
  [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr handle);'
$process = [System.Diagnostics.Process]::GetProcessById(${pid})
$status = [Manelly.Process]::Nt${action === 'suspend' ? 'Suspend' : 'Resume'}Process($process.Handle)
if ($status -ne 0) { throw "NTSTATUS $status" }
`;

function runPowerShell(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(defaultPowershell(), scriptArgs(script), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(scriptError(stdout, stderr, code)))));
  });
}

export const suspendProcess: Suspender = async (pid, action) => {
  if (process.platform === 'win32') return runPowerShell(windowsScript(pid, action));
  process.kill(pid, action === 'suspend' ? 'SIGSTOP' : 'SIGCONT');
};
