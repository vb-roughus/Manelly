# Runs the Manelly agent and starts it again when Manelly asks for a restart – after
# a git pull and a fresh build, when it asks for an update. The autostart and
# start-agent.ps1 run the agent through this script; on its own:
#
#   .\scripts\run-agent.ps1                     run the agent in this window
#   .\scripts\run-agent.ps1 -Node <path> -Autostart
#
# Whatever an update does, the agent starts again – with the build it had, if the
# update failed. Any other end of the agent (Ctrl+C, "Agent beenden" in Manelly,
# a crash) ends this script too.
#
# Written for the Windows PowerShell 5.1 that ships with Windows. Keep this file
# saved as UTF-8 with BOM, otherwise Windows PowerShell garbles the umlauts.
param([string]$Node = 'node', [switch]$Autostart)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$entry = Join-Path (Join-Path (Join-Path $root 'agent') 'dist') 'index.js'
$dataDir = if ($env:AGENT_DATA_DIR) { $env:AGENT_DATA_DIR } else { Join-Path (Join-Path $root 'agent') 'data' }
# The agent's exit codes for "start me again" and "update me first"; the same as in agent/src/index.ts.
$RestartCode = 75
$UpdateCode = 76
# Tells the agent that it can ask for a restart.
$env:MANELLY_AGENT_SUPERVISED = '1'

# Into agent.log, like the agent's own lines – when started by the autostart, nobody sees the console.
function Write-Log([string]$Message) {
  $line = "[$((Get-Date).ToString('dd.MM.yyyy, HH:mm:ss'))] $Message"
  Write-Host $line
  try {
    New-Item -ItemType Directory -Force $dataDir | Out-Null
    [IO.File]::AppendAllText((Join-Path $dataDir 'agent.log'), "$line`n", (New-Object Text.UTF8Encoding $false))
  } catch { }
}

# Output of a tool; it fails on its exit code, not on what it writes to stderr.
function Invoke-Tool([string]$Name, [string]$File, [string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = @(& $File @Arguments 2>&1 | ForEach-Object { "$_" })
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  $text = ($output -join "`n").Trim()
  if ($code -ne 0) {
    # git and npm name the problem on lines starting with fatal: or error:; otherwise the last lines say it.
    $lines = @(($text -split "`n") | Where-Object { $_.Trim() -and $_ -notmatch '^hint:' })
    $named = @($lines | Where-Object { $_ -match '^(fatal|error|npm ERR!)' })
    $tail = $(if ($named.Count) { $named | Select-Object -Last 3 } else { $lines | Select-Object -Last 3 }) -join ' / '
    throw "$Name ist fehlgeschlagen (Exit-Code $code): $tail"
  }
  return $text
}

function Find-Git {
  $command = Get-Command git -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  # The autostart may run without the PATH of an interactive session.
  foreach ($candidate in @("$env:ProgramFiles\Git\cmd\git.exe", "${env:ProgramFiles(x86)}\Git\cmd\git.exe")) {
    if (Test-Path $candidate) { return $candidate }
  }
  throw 'git wurde nicht gefunden – ist Git für Windows installiert?'
}

# npm.cmd next to node.exe keeps working when the execution policy blocks npm.ps1.
function Find-Npm {
  $folder = Split-Path $Node
  foreach ($name in @('npm.cmd', 'npm')) {
    if ($folder -and (Test-Path (Join-Path $folder $name))) { return (Join-Path $folder $name) }
  }
  foreach ($name in @('npm.cmd', 'npm')) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
  }
  throw 'npm wurde nicht gefunden.'
}

# git pull, the dependencies when package-lock.json is newer than what npm installed, and a
# fresh build of the agent. The outcome goes to update.json, where the agent reads it for Manelly.
function Update-Agent {
  $result = [ordered]@{ at = (Get-Date).ToUniversalTime().ToString('o'); ok = $false; from = $null; to = $null; message = '' }
  try {
    $git = Find-Git
    $result.from = Invoke-Tool 'git rev-parse' $git @('rev-parse', '--short', 'HEAD')
    Write-Log 'Update: hole Änderungen (git pull) …'
    $null = Invoke-Tool 'git pull' $git @('pull', '--ff-only')
    $result.to = Invoke-Tool 'git rev-parse' $git @('rev-parse', '--short', 'HEAD')
    $npm = Find-Npm
    $installed = Join-Path 'node_modules' '.package-lock.json'
    if (-not (Test-Path $installed) -or (Get-Item 'package-lock.json').LastWriteTime -gt (Get-Item -Force $installed).LastWriteTime) {
      Write-Log 'Update: installiere Abhängigkeiten (npm ci) …'
      $null = Invoke-Tool 'npm ci' $npm @('ci', '--no-audit', '--no-fund')
    }
    Write-Log 'Update: baue den Agent …'
    $null = Invoke-Tool 'Der Build' $npm @('run', 'build', '-w', 'agent')
    $result.ok = $true
    $result.message = if ($result.from -eq $result.to) { "Schon auf dem neuesten Stand ($($result.to))." } else { "Aktualisiert von $($result.from) auf $($result.to)." }
  } catch {
    $reason = $_.Exception.Message
    if ($reason -match 'fast-forward') { $reason += ' Im Manelly-Ordner auf dem Server gibt es eigene Änderungen – dort «git status» prüfen.' }
    $result.message = "$reason Der Agent startet mit der bisherigen Version."
  }
  Write-Log "Update: $($result.message)"
  try {
    New-Item -ItemType Directory -Force $dataDir | Out-Null
    [IO.File]::WriteAllText((Join-Path $dataDir 'update.json'), ($result | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
  } catch { }
}

$arguments = @($entry)
if ($Autostart) { $arguments += '--autostart' }
while ($true) {
  $ErrorActionPreference = 'Continue'
  & $Node @arguments
  $code = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($code -eq $UpdateCode) {
    Update-Agent
  } elseif ($code -ne $RestartCode) {
    exit $code
  }
  Write-Log 'Starte den Agent neu …'
}
