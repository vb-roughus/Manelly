# Behind the desktop icon «Manelly» (see install-windows.ps1): opens Manelly in the
# browser – and when it is not running yet, starts it first, hidden in the background
# (start-windows.ps1 -Background). A second click while it starts waits for the first.
#
#   powershell -WindowStyle Hidden -File scripts\launch-windows.ps1
#
# Written for the Windows PowerShell 5.1 that ships with Windows. Keep this file
# saved as UTF-8 with BOM, otherwise Windows PowerShell garbles the umlauts.
param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

. (Join-Path $PSScriptRoot 'windows-common.ps1')

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$Port = Get-ManellyPort $root
$url = "http://localhost:$Port"
$data = Join-Path $root 'data'
# Up to this long for the first answer: starting takes a few seconds, the media index longer, but it answers before.
$WaitSeconds = 90

# Without a window, a message box is the only way to say something.
function Show-Problem([string]$Message) {
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.MessageBox]::Show($Message, 'Manelly', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning)
}

function Wait-ForManelly {
  for ($attempt = 0; $attempt -lt $WaitSeconds * 2; $attempt++) {
    if (Test-ManellyRunning $url) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

# What happened: 'open' when Manelly answers, otherwise why not.
function Start-IfNeeded {
  if (Test-ManellyRunning $url) { return 'open' }
  if (Test-PortInUse $Port) { return 'port' }
  $powershell = Join-Path $PSHOME 'powershell.exe'
  $starter = Join-Path $PSScriptRoot 'start-windows.ps1'
  # Quoted by hand: Windows PowerShell does not quote the arguments of Start-Process.
  Start-Process -FilePath $powershell -WindowStyle Hidden -WorkingDirectory $root -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$starter`"", '-Background')
  if (Wait-ForManelly) { return 'open' }
  return 'failed'
}

# One launcher at a time: a second click waits for the first one, then finds Manelly running.
$mutex = New-Object System.Threading.Mutex($false, 'Local\ManellyLaunch')
try {
  [void]$mutex.WaitOne()
} catch [System.Threading.AbandonedMutexException] {
  # The other launcher ended without letting go; the mutex is ours now.
}
try {
  $result = Start-IfNeeded
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}

switch ($result) {
  'open' {
    if (-not $NoBrowser) { Start-Process $url }
  }
  'port' {
    Show-Problem "Port $Port ist von einem anderen Programm belegt – Manelly kann dort nicht starten.`n`nEinen anderen Port wählen: im Manelly-Ordner ($root) in der Datei .env die Zeile PORT=3001 eintragen, oder den Installer mit -Port 3001 erneut ausführen."
    exit 1
  }
  default {
    Show-Problem "Manelly hat nach $WaitSeconds Sekunden nicht geantwortet.`n`nWas es meldete, steht in:`n$(Join-Path $data 'manelly.log')`n$(Join-Path $data 'manelly-error.log')`n`nFehlt Node.js oder der Build, den Installer (scripts\install-windows.cmd) erneut ausführen."
    exit 1
  }
}
