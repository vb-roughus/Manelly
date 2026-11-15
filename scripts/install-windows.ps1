# Installs Manelly on this Windows PC as a program: copies it into its own folder,
# sets up Node.js (and Git, for the updates) with winget, builds it, and puts the icon
# «Manelly» on the desktop and in the start menu. The icon opens Manelly in the
# browser; when it is not running yet, it starts it first, hidden in the background.
# «Manelly beenden» in the start menu ends it; under Settings → Apps it can be
# uninstalled like any program.
#
#   scripts\install-windows.cmd                 into %LOCALAPPDATA%\Programs\Manelly
#   scripts\install-windows.cmd -Port 3001      on another port than 3000
#   scripts\install-windows.cmd -InPlace        this folder stays the program folder
#   scripts\install-windows.cmd -Uninstall      icon, start menu and program go; the settings (data) stay
#
# Running it again updates the installation from this folder; its settings stay.
#
# Written for the Windows PowerShell 5.1 that ships with Windows. Keep this file
# saved as UTF-8 with BOM, otherwise Windows PowerShell garbles the umlauts.
param([int]$Port = 0, [string]$Target = '', [switch]$InPlace, [switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

. (Join-Path $PSScriptRoot 'windows-common.ps1')
Assert-Windows

$source = Split-Path -Parent $PSScriptRoot
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Manelly'
$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Manelly.lnk'
$menuFolder = Join-Path ([Environment]::GetFolderPath('Programs')) 'Manelly'
$powershell = Join-Path $PSHOME 'powershell.exe'

function Show-Message([string]$Message) {
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.MessageBox]::Show($Message, 'Manelly', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
}

# PORT=… in .env, without a byte order mark: Node.js would read it as part of the first name.
function Set-EnvPort([string]$File, [int]$Value) {
  $lines = @()
  if (Test-Path $File) { $lines = @(Get-Content $File | Where-Object { $_ -notmatch '^PORT=' }) }
  $lines += "PORT=$Value"
  [System.IO.File]::WriteAllLines($File, [string[]]$lines, (New-Object System.Text.UTF8Encoding $false))
}

# --- Uninstall ---------------------------------------------------------------
if ($Uninstall) {
  $entry = Get-ItemProperty $uninstallKey -ErrorAction SilentlyContinue
  $folder = if ($entry -and $entry.InstallLocation) { $entry.InstallLocation } else { $source }
  # Out of the folder that is about to go.
  Set-Location $env:TEMP
  if (Stop-BackgroundManelly $folder) { Start-Sleep -Seconds 1 }
  Remove-Item $desktopLink -Force -ErrorAction SilentlyContinue
  Remove-Item $menuFolder -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $uninstallKey -Recurse -Force -ErrorAction SilentlyContinue
  $message = 'Manelly ist deinstalliert: das Symbol auf dem Desktop, das Startmenü und der Eintrag unter «Apps» sind weg.'
  if ($entry -and $entry.InstallMode -eq 'Copy' -and (Test-Path $folder)) {
    # The program goes; the settings (Jellyfin, agent, …) stay, in case it comes back.
    Get-ChildItem -LiteralPath $folder -Force | Where-Object { $_.Name -ne 'data' } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    $message += "`n`nDie Einstellungen bleiben in $(Join-Path $folder 'data'). Wer sie nicht mehr braucht, löscht den Ordner $folder."
  }
  Write-Info $message
  Show-Message $message
  exit 0
}

# --- Where to --------------------------------------------------------------------
if (-not $Target) { $Target = if ($InPlace) { $source } else { Join-Path $env:LOCALAPPDATA 'Programs\Manelly' } }
$Target = [System.IO.Path]::GetFullPath($Target)
$copy = -not [string]::Equals($Target.TrimEnd('\'), $source.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
Write-Info "Installiere Manelly nach $Target …"

# --- Node.js and Git ---------------------------------------------------------------
Initialize-Node
if (-not (Get-Command git -ErrorAction SilentlyContinue) -and (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Info 'Installiere Git mit winget – damit holt Manelly seine Updates …'
  Invoke-Native { winget install --id Git.Git --exact --source winget --accept-source-agreements --accept-package-agreements }
  Update-PathFromRegistry
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Warn 'Git fehlt: Manelly läuft, aber «Aktualisieren» in Manelly geht erst mit Git (https://git-scm.com).'
}
if (-not (Test-Path (Join-Path $source '.git'))) {
  Write-Warn "In $source fehlt .git (z. B. als ZIP heruntergeladen): «Aktualisieren» in Manelly geht nur mit einem Ordner aus «git clone»."
}

# --- Program files -------------------------------------------------------------------
# A Manelly the icon started keeps its files open.
if (Stop-BackgroundManelly $Target) {
  Write-Info 'Das laufende Manelly ist beendet – es startet nach der Installation wieder.'
  Start-Sleep -Seconds 1
}
if ($copy) {
  New-Item -ItemType Directory -Force -Path $Target | Out-Null
  # Everything but the dependencies (installed anew below) and the settings of the installation, which stay.
  $exclude = @('/XD', 'node_modules', (Join-Path $source 'data'))
  if (Test-Path (Join-Path $Target '.env')) { $exclude += @('/XF', (Join-Path $source '.env')) }
  Invoke-Native { robocopy $source $Target /E @exclude /NFL /NDL /NJH /NJS /NP | Out-Null }
  if ($LASTEXITCODE -ge 8) { Stop-WithError "Das Kopieren nach $Target ist fehlgeschlagen (robocopy meldet $LASTEXITCODE)." }
  # Settings of a Manelly that ran in this folder come along – the first time only.
  $sourceData = Join-Path $source 'data'
  $targetData = Join-Path $Target 'data'
  if ((Test-Path $sourceData) -and -not (Test-Path $targetData)) { Copy-Item $sourceData $targetData -Recurse }
}
Set-Location $Target
if ($Port) { Set-EnvPort (Join-Path $Target '.env') $Port }
$Port = Get-ManellyPort $Target $Port
$url = "http://localhost:$Port"
if (Test-ManellyRunning $url) {
  Write-Warn "Auf $url läuft schon ein Manelly in einem Fenster (scripts\start-windows.cmd) – dort mit Ctrl+C beenden, sonst öffnet das Symbol jenes."
}

$npm = Get-Npm
Install-Dependencies $npm
Write-Info 'Baue Manelly …'
Invoke-Native { & $npm run build --silent }
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Der Build ist fehlgeschlagen (siehe oben).' }

# --- Icon on the desktop and in the start menu -------------------------------------
$icon = Join-Path $Target 'scripts\manelly.ico'
$shell = New-Object -ComObject WScript.Shell
function New-Shortcut([string]$Path, [string]$Script, [string]$Description) {
  $link = $shell.CreateShortcut($Path)
  $link.TargetPath = $powershell
  $link.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $Target "scripts\$Script")`""
  $link.WorkingDirectory = $Target
  $link.IconLocation = "$icon,0"
  # Minimized, so the moment until PowerShell hides itself stays out of sight.
  $link.WindowStyle = 7
  $link.Description = $Description
  $link.Save()
}
New-Shortcut $desktopLink 'launch-windows.ps1' 'Manelly öffnen – startet es, wenn es noch nicht läuft'
New-Item -ItemType Directory -Force -Path $menuFolder | Out-Null
New-Shortcut (Join-Path $menuFolder 'Manelly.lnk') 'launch-windows.ps1' 'Manelly öffnen – startet es, wenn es noch nicht läuft'
New-Shortcut (Join-Path $menuFolder 'Manelly beenden.lnk') 'stop-windows.ps1' 'Manelly beenden'

# --- Listed under Settings → Apps, with «Deinstallieren» ------------------------------
$version = (Get-Content (Join-Path $Target 'package.json') -Raw | ConvertFrom-Json).version
New-Item -Path $uninstallKey -Force | Out-Null
$values = [ordered]@{
  DisplayName = 'Manelly'
  DisplayVersion = $version
  Publisher = 'Manelly'
  DisplayIcon = $icon
  InstallLocation = $Target
  InstallMode = $(if ($copy) { 'Copy' } else { 'InPlace' })
  URLInfoAbout = $url
  UninstallString = "`"$powershell`" -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $Target 'scripts\install-windows.ps1')`" -Uninstall"
}
foreach ($name in $values.Keys) { New-ItemProperty -Path $uninstallKey -Name $name -Value $values[$name] -PropertyType String -Force | Out-Null }
foreach ($name in @('NoModify', 'NoRepair')) { New-ItemProperty -Path $uninstallKey -Name $name -Value 1 -PropertyType DWord -Force | Out-Null }

# --- Start --------------------------------------------------------------------------
Write-Info 'Starte Manelly …'
& $powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Target 'scripts\launch-windows.ps1')
Write-Info "Fertig: Manelly ist installiert ($Target). Das Symbol «Manelly» auf dem Desktop öffnet es im Browser und startet es, wenn es nicht läuft; «Manelly beenden» steht im Startmenü."
