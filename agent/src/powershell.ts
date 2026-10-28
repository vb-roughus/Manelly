import { spawn } from 'node:child_process';
import { constants as osConstants, setPriority } from 'node:os';
import path from 'node:path';

// Windows PowerShell 5.1 ships with every Windows. The scripts write JSON; non-ASCII
// characters (adapter names like "Bluetooth-Netzwerkverbindung") are escaped, so the
// output does not depend on the console code page.

/** PowerShell expression: the JSON in `$json` with every non-ASCII character as \\uXXXX. */
export const ASCII_JSON = `[regex]::Replace($json, '[^\\x00-\\x7F]', { param($m) '\\u{0:x4}' -f [int][char]$m.Value })`;

export function defaultPowershell(env: NodeJS.ProcessEnv = process.env): string {
  return path.win32.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

const argsFor = (script: string) => ['-NoProfile', '-NonInteractive', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];

/**
 * Started by another program, Windows PowerShell writes progress and errors to stderr as CLIXML ("#< CLIXML …").
 * These scripts therefore run without progress records and report their own error on stdout as "ERROR: …" – the
 * innermost message, e.g. what DPAPI says rather than "Exception calling …".
 */
export function scriptArgs(script: string): string[] {
  const wrapped = `$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
try {
${script}
} catch {
  $e = $_.Exception
  while ($e.InnerException) { $e = $e.InnerException }
  [Console]::Out.Write("ERROR: $($e.Message)")
  exit 1
}`;
  return ['-NoProfile', '-NonInteractive', '-NoLogo', '-InputFormat', 'Text', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(wrapped, 'utf16le').toString('base64')];
}

const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** The error text in PowerShell's CLIXML; anything else as it is. */
export function decodeClixml(text: string): string {
  if (!text.trimStart().startsWith('#< CLIXML')) return text;
  return [...text.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)]
    .map((match) =>
      match[1]!
        // Control characters come as _xHHHH_.
        .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&(lt|gt|amp|quot|apos);/g, (_, name: string) => XML_ENTITIES[name]!),
    )
    .join('');
}

/** Why a script from scriptArgs failed, in one line: its own report, else the first line PowerShell wrote to stderr. */
export function scriptError(stdout: string, stderr: string, code: number | null): string {
  const reported = stdout.match(/ERROR: ([\s\S]*)$/)?.[1]?.trim();
  if (reported) return reported;
  const line = decodeClixml(stderr)
    .split(/\r?\n/)
    .map((text) => text.trim())
    .find(Boolean);
  return line ?? `PowerShell endete mit ${code}.`;
}

/** Runs a script to its end and returns what it wrote. */
export function runPowershell(executable: string, script: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, argsFor(script), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (out += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (err += chunk));
    child.on('error', (error) => reject(new Error(`PowerShell liess sich nicht starten: ${error.message}`)));
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(decodeClixml(err).trim() || `Exit-Code ${code}`))));
  });
}

/**
 * Runs a script that writes one line per sample, for as long as the measuring runs; at low
 * priority. It ends by itself when the agent goes away (its output pipe breaks).
 */
export function streamPowershell(executable: string, script: string, onLine: (line: string) => void, onError: (message: string) => void): () => void {
  const child = spawn(executable, argsFor(script), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    if (child.pid) setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // Measuring works without it.
  }
  let stopped = false;
  let buffer = '';
  let err = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) onLine(line);
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    err = (err + chunk).slice(-4000);
  });
  child.on('error', (error) => !stopped && onError(`PowerShell liess sich nicht starten: ${error.message}`));
  child.on('close', (code) => !stopped && onError(`Die Messung endete unerwartet (Exit-Code ${code}). ${decodeClixml(err).trim().split(/\r?\n/).slice(-3).join(' ')}`.trim()));
  return () => {
    stopped = true;
    child.kill();
  };
}
