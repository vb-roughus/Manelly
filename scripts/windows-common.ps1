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

function Get-VersionOf([string]$NodeExe) {
  try {
    return [version]((& $NodeExe --version) -replace '^v', '')
  } catch {
    return $null
  }
}

function Test-InSavedPath([string]$Dir) {
  # Compares with the PATH saved for the machine and the user, not just this session.
  $normalize = { param($value) $value.Trim().TrimEnd('\').ToLowerInvariant() }
  $wanted = & $normalize $Dir
  foreach ($scope in 'Machine', 'User') {
    $saved = [Environment]::GetEnvironmentVariable('Path', $scope)
    if ($saved -and ($saved -split ';' | Where-Object { $_ -and (& $normalize $_) -eq $wanted })) { return $true }
  }
  return $false
}

function Add-ToUserPath([string]$Dir) {
  # Edit the registry value directly, so entries like %USERPROFILE%\… stay unexpanded
  # (that is where the winget command lives).
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
  try {
    $current = $key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $updated = if ($current) { "$($current.TrimEnd(';'));$Dir" } else { $Dir }
    $key.SetValue('Path', $updated, [Microsoft.Win32.RegistryValueKind]::ExpandString)
  } finally {
    $key.Close()
  }
  # Setting any user variable makes Windows tell running programs (e.g. Explorer) about the change.
  [Environment]::SetEnvironmentVariable('MANELLY_PATH_UPDATED', '1', 'User')
  [Environment]::SetEnvironmentVariable('MANELLY_PATH_UPDATED', $null, 'User')
}

# Where Node.js usually lives on Windows, also when its folder is missing from the PATH.
function Get-NodeFolders {
  $folders = @()
  # The official installer records its folder in the registry.
  foreach ($key in 'HKLM:\SOFTWARE\Node.js', 'HKCU:\SOFTWARE\Node.js', 'HKLM:\SOFTWARE\WOW6432Node\Node.js') {
    $installPath = (Get-ItemProperty $key -ErrorAction SilentlyContinue).InstallPath
    if ($installPath) { $folders += $installPath }
  }
  if ($env:ProgramFiles) { $folders += Join-Path $env:ProgramFiles 'nodejs' }
  if (${env:ProgramFiles(x86)}) { $folders += Join-Path ${env:ProgramFiles(x86)} 'nodejs' }
  # Installed for the current user only.
  if ($env:LOCALAPPDATA) { $folders += Join-Path $env:LOCALAPPDATA 'Programs\nodejs' }
  # nvm-windows: the active version is a link, all versions are folders in NVM_HOME (newest first).
  if ($env:NVM_SYMLINK) { $folders += $env:NVM_SYMLINK }
  if ($env:NVM_HOME -and (Test-Path $env:NVM_HOME)) {
    $folders += Get-ChildItem $env:NVM_HOME -Directory -Filter 'v*' |
      Sort-Object { try { [version]$_.Name.TrimStart('v') } catch { [version]'0.0' } } -Descending |
      ForEach-Object { $_.FullName }
  }
  return $folders | Where-Object { $_ -and (Test-Path (Join-Path $_ 'node.exe')) } | Select-Object -Unique
}

# Node.js is installed, but its folder is not in the PATH: use it and add it again.
function Repair-NodePath {
  foreach ($folder in Get-NodeFolders) {
    $version = Get-VersionOf (Join-Path $folder 'node.exe')
    if ($null -eq $version -or $version -lt $MinNodeVersion) { continue }
    $env:Path = "$folder;$env:Path"
    $isNvmVersion = $env:NVM_HOME -and $folder.StartsWith($env:NVM_HOME, [StringComparison]::OrdinalIgnoreCase) -and -not ($env:NVM_SYMLINK -and $folder -eq $env:NVM_SYMLINK)
    if ($isNvmVersion) {
      # nvm-windows switches versions through its link; a fixed version folder does not belong in the PATH.
      Write-Warn "Node.js $version von nvm-windows ist nicht aktiv (die Verknüpfung $env:NVM_SYMLINK fehlt). Dieses Skript verwendet $folder; dauerhaft beheben mit «nvm use $version» in einer Administrator-PowerShell."
    } elseif (Test-InSavedPath $folder) {
      Write-Info "Node.js $version liegt in $folder (im PATH eingetragen; dieses Fenster kannte ihn noch nicht)."
    } else {
      Add-ToUserPath $folder
      Write-Warn "Node.js $version liegt in $folder, aber der Ordner fehlte im PATH. Für deinen Benutzer eingetragen – neue Fenster finden node jetzt auch."
    }
    return $true
  }
  return $false
}

function Initialize-Node {
  if (Test-Node) {
    Write-Info "Node.js $(& node --version) ist vorhanden."
    return
  }
  if ((Repair-NodePath) -and (Test-Node)) { return }
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
  # winget may report Node.js as installed although its folder is missing from the PATH.
  if (-not (Test-Node)) { $null = Repair-NodePath }
  if (-not (Test-Node)) {
    $found = Get-NodeVersion
    $where = (Get-Command node -ErrorAction SilentlyContinue).Source
    $detail = if ($found) { "Gefunden: Node.js $found ($where)." } else { 'Node.js wurde weder im PATH noch an den üblichen Orten gefunden.' }
    Stop-WithError "Node.js $MinNodeVersion oder neuer ist nicht verfügbar. $detail Installiere Node.js (LTS) von https://nodejs.org neu und starte das Skript danach erneut."
  }
  Write-Info "Verwende Node.js $(& node --version)."
}

# npm.cmd keeps working when the execution policy blocks npm.ps1. It sits next to
# node.exe, unless Node.js was installed without it.
function Get-Npm {
  $command = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if ($node) {
    $nextToNode = Join-Path (Split-Path $node) 'npm.cmd'
    if (Test-Path $nextToNode) { return $nextToNode }
  }
  if (Get-Command npm -ErrorAction SilentlyContinue) { return 'npm' }
  Stop-WithError 'npm fehlt. Installiere Node.js (LTS) von https://nodejs.org neu, mit dem Bestandteil «npm package manager».'
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
