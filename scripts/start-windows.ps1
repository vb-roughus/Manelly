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
# no window, the server's output goes to data\manelly.log, an existing build is
# used as it is, and the browser is left to the icon. data\manelly.pid names this
# script's process, so «Manelly beenden» can end it.
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
Assert-Windows

# --- Port --------------------------------------------------------------------
$Port = Get-ManellyPort $root $Port
$env:PORT = "$Port"
$url = "http://localhost:$Port"

if (Test-PortInUse $Port) {
  # In the background nobody reads it; the desktop icon looked before.
  if ($Background) { exit 1 }
  Stop-WithError "Port $Port ist schon belegt – läuft Manelly bereits? Dann öffne $url. Sonst starte mit: .\scripts\start-windows.ps1 -Port 3001"
}

# --- Node.js, dependencies and build -------------------------------------------
$built = (Test-Path 'server\dist\index.js') -and (Test-Path 'web\dist\index.html')
if ($Background -and $built -and (Test-Node)) {
  # Installed and built by install-windows.ps1, updated by Manelly itself: starting is enough.
} else {
  # Nobody could answer winget in the background: the installer sets Node.js up.
  if ($Background -and -not (Test-Node)) { exit 1 }
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
$data = Join-Path $root 'data'
if ($Background) {
  New-Item -ItemType Directory -Force -Path $data | Out-Null
  Set-Content -Path (Join-Path $data 'manelly.pid') -Value $PID -Encoding ASCII
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
      try {
        $null = Invoke-WebRequest "$url/api/health" -UseBasicParsing -TimeoutSec 2
        $ready = $true
        break
      } catch {
        Start-Sleep -Milliseconds 500
      }
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
    if ($Background) { Remove-Item (Join-Path $data 'manelly.pid') -Force -ErrorAction SilentlyContinue }
    exit $server.ExitCode
  }
  Write-Info 'Starte Manelly neu …'
}
