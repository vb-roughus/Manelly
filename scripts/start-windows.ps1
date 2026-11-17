# Installs what Manelly needs on Windows (via winget), builds it and starts it.
#
#   .\scripts\start-windows.ps1              start on port 3000
#   .\scripts\start-windows.ps1 -Port 3001   start on another port
#
# Or double-click scripts\start-windows.cmd, which also works when PowerShell
# scripts are blocked. Stop Manelly with Ctrl+C. Restarting and updating from
# Server → Allgemein in Manelly keep this script running: it starts Manelly again.
#
# With -Background (the desktop icon of install-windows.ps1 starts it so, hidden):
# no window, the server's output goes to data\manelly.log, what this script says to
# data\manelly-start.log (the icon's window shows both), an existing build is used as
# it is, and the browser is left to the icon. data\manelly.pid names this script's
# process, so «Manelly beenden» can end it.
#
# Written for the Windows PowerShell 5.1 that ships with Windows. Keep this file
# saved as UTF-8 with BOM, otherwise Windows PowerShell garbles the umlauts.
param([int]$Port = 0, [switch]$Background)

$ErrorActionPreference = 'Stop'
# Invoke-WebRequest would otherwise draw a progress bar for every health check.
$ProgressPreference = 'SilentlyContinue'

. (Join-Path $PSScriptRoot 'windows-common.ps1')

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$data = Join-Path $root 'data'
if ($Background) {
  # Nobody sees this window: what this script says goes to data\manelly-start.log as well, where the desktop icon
  # (launch-windows.ps1) reads it while Manelly starts – and when the start fails.
  New-Item -ItemType Directory -Force -Path $data | Out-Null
  $ManellyLog = Join-Path $data 'manelly-start.log'
  Remove-Item -LiteralPath $ManellyLog -Force -ErrorAction SilentlyContinue
}
# An unexpected error ends this script as before; in the background it is written down first.
trap {
  if ($Background) { Write-Logged "! $($_.Exception.Message)" }
  break
}
Assert-Windows

# --- Port --------------------------------------------------------------------
$Port = Get-ManellyPort $root $Port
$env:PORT = "$Port"
$url = "http://localhost:$Port"

if (Test-PortInUse $Port) {
  if ($Background) { Stop-WithError "Port $Port ist schon belegt – von einem anderen Programm oder einem Manelly, das schon läuft." }
  Stop-WithError "Port $Port ist schon belegt – läuft Manelly bereits? Dann öffne $url. Sonst starte mit: .\scripts\start-windows.ps1 -Port 3001"
}

# --- Node.js, dependencies and build -------------------------------------------
$built = (Test-Path 'server\dist\index.js') -and (Test-Path 'web\dist\index.html')
# Started from the desktop icon, this script has Explorer's PATH, which may not know a Node.js installed just now.
if ($Background -and -not (Test-Node)) { $null = Repair-NodePath }
if ($Background -and $built -and (Test-Node)) {
  # Installed and built by install-windows.ps1, updated by Manelly itself: starting is enough.
} else {
  # Nobody could answer winget in the background: the installer sets Node.js up.
  if ($Background -and -not (Test-Node)) { Stop-WithError "Node.js $MinNodeVersion oder neuer fehlt. Den Installer (scripts\install-windows.cmd) nochmals ausführen – er richtet es ein." }
  Initialize-Node
  $npm = Get-Npm
  Install-Dependencies $npm

  Write-Info 'Baue Manelly …'
  Invoke-Native { & $npm run build --silent }
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'Der Build ist fehlgeschlagen (siehe oben).' }
}

# --- Start -------------------------------------------------------------------
# Manelly asks for a restart with exit code 75 (RESTART_EXIT in server/src/manelly.ts), also after
# it updated itself; any other end, e.g. Ctrl+C, ends this script too.
$env:MANELLY_SUPERVISED = '1'
$nodeArgs = @('server/dist/index.js')
if (Test-Path .env) { $nodeArgs = @('--env-file=.env') + $nodeArgs }
if ($Background) {
  Set-Content -Path (Join-Path $data 'manelly.pid') -Value $PID -Encoding ASCII
  Write-Info 'Starte den Server …'
} else {
  Write-Info "Starte Manelly auf $url – beenden mit Ctrl+C."
}
# The desktop icon opens the browser itself.
$opened = [bool]$Background
while ($true) {
  if ($Background) {
    # The last start's output stays readable next to the current one.
    $log = Join-Path $data 'manelly.log'
    $errorLog = Join-Path $data 'manelly-error.log'
    foreach ($file in @($log, $errorLog)) {
      if (Test-Path $file) { Move-Item $file "$file.1" -Force -ErrorAction SilentlyContinue }
    }
    # Shares this script's hidden console: no window of its own.
    $server = Start-Process -FilePath node -ArgumentList $nodeArgs -WorkingDirectory $root -NoNewWindow -RedirectStandardOutput $log -RedirectStandardError $errorLog -PassThru
  } else {
    $server = Start-Process -FilePath node -ArgumentList $nodeArgs -WorkingDirectory $root -NoNewWindow -PassThru
  }
  # Reading the handle now keeps ExitCode available after the process ended.
  $null = $server.Handle

  # Open the browser as soon as the server answers, the first time only.
  if (-not $opened) {
    $opened = $true
    $ready = $false
    for ($attempt = 0; $attempt -lt 60 -and -not $server.HasExited; $attempt++) {
      if (Test-ManellyRunning $Port) {
        $ready = $true
        break
      }
      Start-Sleep -Milliseconds 500
    }
    if ($ready) {
      try {
        Start-Process $url
      } catch {
        Write-Info "Öffne $url im Browser."
      }
    }
  }

  $server.WaitForExit()
  if ($server.ExitCode -ne 75) {
    if ($Background) {
      Remove-Item (Join-Path $data 'manelly.pid') -Force -ErrorAction SilentlyContinue
      if ($server.ExitCode -ne 0) { Write-Warn "Der Server hat sich mit Code $($server.ExitCode) beendet." }
    }
    exit $server.ExitCode
  }
  Write-Info 'Starte Manelly neu …'
}
