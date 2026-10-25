# Shared by the Windows scripts (start-windows.ps1, start-agent.ps1); dot-source it.
#
# Written for the Windows PowerShell 5.1 that ships with Windows. Keep this file
# saved as UTF-8 with BOM, otherwise Windows PowerShell garbles the umlauts.

$NodePackage = 'OpenJS.NodeJS.LTS'
$MinNodeVersion = [version]'22.12.0'

function Write-Info([string]$Message) {
  Write-Host '> ' -ForegroundColor Magenta -NoNewline
  Write-Host $Message
}

function Write-Warn([string]$Message) {
  Write-Host '! ' -ForegroundColor Yellow -NoNewline
  Write-Host $Message
}

function Stop-WithError([string]$Message) {
  Write-Host '! ' -ForegroundColor Red -NoNewline
  Write-Host $Message
  exit 1
}

function Assert-Windows {
  if ($env:OS -ne 'Windows_NT') {
    Stop-WithError 'Dieses Skript ist für Windows gedacht. Für andere Systeme siehe README.'
  }
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

function Test-PortInUse([int]$Port) {
  $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
  return [bool]($listeners | Where-Object { $_.Port -eq $Port })
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

function Install-WingetPackage([string]$Id, [string]$Name) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Stop-WithError "$Name fehlt, und winget ist nicht verfügbar. Installiere $Name von Hand und starte das Skript danach erneut."
  }
  Write-Info "Installiere $Name mit winget …"
  # winget upgrades an existing installation; Windows may ask for permission.
  Invoke-Native { winget install --id $Id --exact --source winget --accept-source-agreements --accept-package-agreements }
  Update-PathFromRegistry
}

function Initialize-Node {
  if (Test-Node) {
    Write-Info "Node.js $(& node --version) ist vorhanden."
    return
  }
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
function Get-Npm {
  if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { return 'npm.cmd' }
  return 'npm'
}

# npm records the installed state in node_modules\.package-lock.json; reinstall
# only when package-lock.json changed since then (e.g. after a git pull).
function Install-Dependencies([string]$Npm) {
  $installed = Join-Path 'node_modules' '.package-lock.json'
  if (-not (Test-Path $installed) -or (Get-Item package-lock.json).LastWriteTime -gt (Get-Item -Force $installed).LastWriteTime) {
    Write-Info 'Installiere Abhängigkeiten …'
    Invoke-Native { & $Npm ci --no-audit --no-fund }
    if ($LASTEXITCODE -ne 0) { Stop-WithError 'Die Abhängigkeiten konnten nicht installiert werden (siehe oben).' }
  }
}
