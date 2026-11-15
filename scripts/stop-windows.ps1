# «Manelly beenden» in the start menu (see install-windows.ps1): ends a Manelly that
# the desktop icon started in the background – its starter and the server.
#
# Written for the Windows PowerShell 5.1 that ships with Windows. Keep this file
# saved as UTF-8 with BOM, otherwise Windows PowerShell garbles the umlauts.
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'windows-common.ps1')

$root = Split-Path -Parent $PSScriptRoot
$stopped = Stop-BackgroundManelly $root

Add-Type -AssemblyName System.Windows.Forms
$message = if ($stopped) {
  'Manelly ist beendet. Mit dem Symbol «Manelly» auf dem Desktop startet es wieder.'
} else {
  'Manelly lief nicht im Hintergrund. Wurde es mit scripts\start-windows.cmd gestartet, dort im Fenster mit Ctrl+C beenden.'
}
[void][System.Windows.Forms.MessageBox]::Show($message, 'Manelly', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
