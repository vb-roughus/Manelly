# Installs what Manelly needs on Windows (via winget), builds it and starts it.
#
#   .\scripts\start-windows.ps1              start on port 3000
#   .\scripts\start-windows.ps1 -Port 3001   start on another port
#
# Or double-click scripts\start-windows.cmd, which also works when PowerShell
# scripts are blocked. Stop Manelly with Ctrl+C.
#
# Written for the Windows PowerShell 5.1 that ships with Windows. Keep this file
# saved as UTF-8 with BOM, otherwise Windows PowerShell garbles the umlauts.
param([int]$Port = 0)

$ErrorActionPreference = 'Stop'
# Invoke-WebRequest would otherwise draw a progress bar for every health check.
$ProgressPreference = 'SilentlyContinue'

. (Join-Path $PSScriptRoot 'windows-common.ps1')

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Assert-Windows

# --- Port --------------------------------------------------------------------
if (-not $Port -and $env:PORT) { $Port = [int]$env:PORT }
if (-not $Port -and (Test-Path .env)) {
  $line = Get-Content .env | Where-Object { $_ -match '^PORT=\d+\s*$' } | Select-Object -Last 1
  if ($line) { $Port = [int]($line -replace '^PORT=(\d+)\s*$', '$1') }
}
if (-not $Port) { $Port = 3000 }
$env:PORT = "$Port"
$url = "http://localhost:$Port"

if (Test-PortInUse $Port) {
  Stop-WithError "Port $Port ist schon belegt – läuft Manelly bereits? Dann öffne $url. Sonst starte mit: .\scripts\start-windows.ps1 -Port 3001"
}

# --- Node.js, dependencies and build -------------------------------------------
Initialize-Node
$npm = Get-Npm
Install-Dependencies $npm

Write-Info 'Baue Manelly …'
Invoke-Native { & $npm run build --silent }
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Der Build ist fehlgeschlagen (siehe oben).' }

# --- Start -------------------------------------------------------------------
Write-Info "Starte Manelly auf $url – beenden mit Ctrl+C."
$nodeArgs = @('server/dist/index.js')
if (Test-Path .env) { $nodeArgs = @('--env-file=.env') + $nodeArgs }
$server = Start-Process -FilePath node -ArgumentList $nodeArgs -WorkingDirectory $root -NoNewWindow -PassThru
# Reading the handle now keeps ExitCode available after the process ended.
$null = $server.Handle

# Open the browser as soon as the server answers.
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

$server.WaitForExit()
exit $server.ExitCode
