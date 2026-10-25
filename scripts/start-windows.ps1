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

$NodePackage = 'OpenJS.NodeJS.LTS'
$MinNodeVersion = [version]'22.12.0'

function Write-Info([string]$Message) {
  Write-Host '> ' -ForegroundColor Magenta -NoNewline
  Write-Host $Message
}

function Stop-WithError([string]$Message) {
  Write-Host '! ' -ForegroundColor Red -NoNewline
  Write-Host $Message
  exit 1
}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if ($env:OS -ne 'Windows_NT') {
  Stop-WithError 'Dieses Skript ist für Windows gedacht. Für andere Systeme siehe README.'
}

# The build tools (Vite) need Node.js 22.12 or newer.
function Get-NodeVersion {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $null }
  try {
    return [version]((& node --version) -replace '^v', '')
  } catch {
    return $null
  }
}

function Test-Node {
  $version = Get-NodeVersion
  return ($null -ne $version) -and ($version -ge $MinNodeVersion)
}

function Invoke-Native([scriptblock]$Command) {
  # Some hosts (e.g. the PowerShell ISE) turn messages a program writes to stderr
  # into errors, which would stop the script; the exit code tells success instead.
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Command } finally { $ErrorActionPreference = $previous }
}

function Update-PathFromRegistry {
  # winget changes the PATH in the registry, but not in this session.
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ';'
}

# --- Port --------------------------------------------------------------------
if (-not $Port -and $env:PORT) { $Port = [int]$env:PORT }
if (-not $Port -and (Test-Path .env)) {
  $line = Get-Content .env | Where-Object { $_ -match '^PORT=\d+\s*$' } | Select-Object -Last 1
  if ($line) { $Port = [int]($line -replace '^PORT=(\d+)\s*$', '$1') }
}
if (-not $Port) { $Port = 3000 }
$env:PORT = "$Port"
$url = "http://localhost:$Port"

$listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
if ($listeners | Where-Object { $_.Port -eq $Port }) {
  Stop-WithError "Port $Port ist schon belegt – läuft Manelly bereits? Dann öffne $url. Sonst starte mit: .\scripts\start-windows.ps1 -Port 3001"
}

# --- Node.js -----------------------------------------------------------------
if (Test-Node) {
  Write-Info "Node.js $(& node --version) ist vorhanden."
} else {
  $current = Get-NodeVersion
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    $found = if ($current) { "Gefunden: Node.js $current. " } else { '' }
    Stop-WithError "Manelly braucht Node.js $MinNodeVersion oder neuer. $($found)winget ist nicht verfügbar – installiere Node.js (LTS) von https://nodejs.org und starte das Skript danach erneut."
  }
  if ($current) {
    Write-Info "Node.js $current ist zu alt, aktualisiere mit winget …"
  } else {
    Write-Info 'Installiere Node.js (LTS) mit winget …'
  }
  # winget upgrades an existing installation; Windows may ask for permission.
  Invoke-Native { winget install --id $NodePackage --exact --source winget --accept-source-agreements --accept-package-agreements }
  Update-PathFromRegistry
  if (-not (Test-Node)) {
    $found = Get-NodeVersion
    $where = (Get-Command node -ErrorAction SilentlyContinue).Source
    $detail = if ($found) { "Gefunden: Node.js $found ($where)." } else { 'Node.js wurde nicht gefunden.' }
    Stop-WithError "Node.js $MinNodeVersion oder neuer ist nicht verfügbar. $detail Öffne ein neues Fenster und starte das Skript erneut, oder installiere Node.js (LTS) von https://nodejs.org."
  }
  Write-Info "Verwende Node.js $(& node --version)."
}

# npm.cmd keeps working when the execution policy blocks npm.ps1.
$npm = if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { 'npm.cmd' } else { 'npm' }

# --- Dependencies and build --------------------------------------------------
# npm records the installed state in node_modules\.package-lock.json; reinstall
# only when package-lock.json changed since then (e.g. after a git pull).
$installed = Join-Path 'node_modules' '.package-lock.json'
if (-not (Test-Path $installed) -or (Get-Item package-lock.json).LastWriteTime -gt (Get-Item -Force $installed).LastWriteTime) {
  Write-Info 'Installiere Abhängigkeiten …'
  Invoke-Native { & $npm ci --no-audit --no-fund }
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'Die Abhängigkeiten konnten nicht installiert werden (siehe oben).' }
}

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
