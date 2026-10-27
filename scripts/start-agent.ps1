# Installs the Manelly agent on the Windows machine running Jellyfin and starts
# it. The agent converts files there when Manelly asks it to (Dolby Vision
# profile 7 to 8.1); Manelly always names the files, the agent searches nothing.
#
#   .\scripts\start-agent.ps1              install what is missing, start the agent in this window
#   .\scripts\start-agent.ps1 -Install     start it automatically and open the firewall port; as administrator
#                                          it starts with Windows, without anybody logging on. A running
#                                          agent (also an older version) is ended and replaced.
#   .\scripts\start-agent.ps1 -Install -StorePassword
#                                          the same with your Windows password stored in the task, for media
#                                          on network shares (without it, the agent reaches local drives only)
#   .\scripts\start-agent.ps1 -Uninstall   remove the autostart and the firewall rule again
#   .\scripts\start-agent.ps1 -Port 8791   use another port (saved in agent\data\agent.json)
#
# Or double-click scripts\start-agent.cmd. Stop the agent with Ctrl+C.
#
# Written for the Windows PowerShell 5.1 that ships with Windows. Keep this file
# saved as UTF-8 with BOM, otherwise Windows PowerShell garbles the umlauts.
param([switch]$Install, [switch]$Uninstall, [switch]$StorePassword, [int]$Port = 0)

$ErrorActionPreference = 'Stop'
# Invoke-WebRequest would otherwise draw a progress bar for every request.
$ProgressPreference = 'SilentlyContinue'

. (Join-Path $PSScriptRoot 'windows-common.ps1')

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Assert-Windows

$TaskName = 'Manelly Agent'
$FirewallRule = 'Manelly Agent'
$DefaultPort = 8790
# Pinned release; the checksum guards against a tampered download.
$DoviToolVersion = '2.3.4'
$DoviToolSha256 = '0D9733D311DFE49F9DCA0C350F7E6D978182673D333C6F07F7365DAF9E6C81EB'

$agentDir = Join-Path $root 'agent'
$toolsDir = Join-Path $agentDir 'tools'
$dataDir = Join-Path $agentDir 'data'
$configFile = Join-Path $dataDir 'agent.json'

function Test-Admin {
  $identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  return $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Read-AgentConfig {
  if (-not (Test-Path $configFile)) { return $null }
  try {
    return Get-Content $configFile -Raw | ConvertFrom-Json
  } catch {
    Stop-WithError "$configFile ist kein gültiges JSON: $($_.Exception.Message)"
  }
}

function Save-AgentConfig($Config) {
  New-Item -ItemType Directory -Force $dataDir | Out-Null
  # Without BOM: Node's JSON parser does not expect one.
  [IO.File]::WriteAllText($configFile, ($Config | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
}

function Save-AgentPort([int]$Value) {
  $config = Read-AgentConfig
  if ($null -eq $config) { $config = [pscustomobject]@{} }
  $config | Add-Member -NotePropertyName port -NotePropertyValue $Value -Force
  Save-AgentConfig $config
}

# The autostart may run without the PATH of this session; tools found only there go into agent.json.
function Save-ToolPaths([hashtable]$KnownLocations) {
  $config = Read-AgentConfig
  if ($null -eq $config) { $config = [pscustomobject]@{} }
  $tools = if ($config.tools) { $config.tools } else { [pscustomobject]@{} }
  $changed = $false
  foreach ($name in $KnownLocations.Keys) {
    if ((Test-Path $KnownLocations[$name]) -or $tools.$name) { continue }
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command) {
      $tools | Add-Member -NotePropertyName $name -NotePropertyValue $command.Source -Force
      $changed = $true
    }
  }
  if ($changed) {
    $config | Add-Member -NotePropertyName tools -NotePropertyValue $tools -Force
    Save-AgentConfig $config
    Write-Info "Werkzeugpfade in $configFile eingetragen."
  }
}

# The version in this folder, to tell it from an agent that still runs from before.
function Get-CheckoutVersion {
  return [string](Get-Content (Join-Path $agentDir 'package.json') -Raw | ConvertFrom-Json).version
}

# What answers on the port: the version of a Manelly agent, '' for an agent before 0.7.0, $null for anything else.
function Get-RunningAgentVersion([int]$Value) {
  try {
    $health = Invoke-RestMethod "http://localhost:$Value/api/health" -TimeoutSec 2
    if ($health.status -eq 'ok') { return [string]$health.version }
  } catch { }
  return $null
}

# An agent started earlier (in a window, by the autostart, or by an older install) keeps the port busy.
# First it is asked to end itself (a running conversion then continues later), then every agent
# process still holding the port, or running from this folder, is ended. Fails when the port stays busy.
function Stop-RunningAgent([int]$Value) {
  $config = Read-AgentConfig
  if ((Test-PortInUse $Value) -and $config -and $config.token) {
    try {
      $null = Invoke-RestMethod -Method Post "http://localhost:$Value/api/shutdown" -Headers @{ Authorization = "Bearer $($config.token)" } -TimeoutSec 5
      Write-Info 'Der laufende Agent beendet sich …'
      for ($attempt = 0; $attempt -lt 60 -and (Test-PortInUse $Value); $attempt++) { Start-Sleep -Milliseconds 250 }
    } catch {
      # Agents before 0.7.0 cannot end themselves; they are ended below.
    }
  }

  $entry = Join-Path $agentDir 'dist\index.js'
  $ids = @(Get-NetTCPConnection -LocalPort $Value -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess)
  $ids += @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($entry, [StringComparison]::OrdinalIgnoreCase) -ge 0 } |
    Select-Object -ExpandProperty ProcessId)
  foreach ($processId in @($ids | Sort-Object -Unique)) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (-not $process -or $process.ProcessName -ne 'node') { continue }
    Write-Info "Beende den laufenden Agent (node.exe, Prozess $processId) – eine laufende Umwandlung macht danach weiter."
    try {
      Stop-Process -Id $processId -Force -ErrorAction Stop
    } catch {
      Write-Warn "Prozess $processId liess sich nicht beenden: $($_.Exception.Message)"
    }
  }

  for ($attempt = 0; $attempt -lt 40 -and (Test-PortInUse $Value); $attempt++) { Start-Sleep -Milliseconds 250 }
  if (Test-PortInUse $Value) {
    $holders = @(Get-NetTCPConnection -LocalPort $Value -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
      $holder = Get-Process -Id $_ -ErrorAction SilentlyContinue
      if ($holder) { "$($holder.ProcessName).exe (Prozess $_)" } else { "Prozess $_" }
    })
    $by = if ($holders.Count) { " durch $($holders -join ', ')" } else { '' }
    $hint = if (Test-Admin) {
      'Den Prozess im Task-Manager unter «Details» beenden und das Skript erneut ausführen.'
    } else {
      'Das Skript als Administrator ausführen (Rechtsklick auf start-agent.cmd), oder den Prozess im Task-Manager unter «Details» beenden.'
    }
    Stop-WithError "Port $Value ist noch belegt$by. $hint"
  }
}

# True once the agent of this folder answers – not an old one that still holds the port.
function Wait-AgentHealthy([int]$Value, [string]$Expected) {
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    if ((Get-RunningAgentVersion $Value) -eq $Expected) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Show-Connection([int]$Value) {
  $config = Read-AgentConfig
  Write-Host ''
  Write-Host 'In Manelly unter Server → Agent eintragen:'
  Write-Host "  Adresse:   http://$($env:COMPUTERNAME.ToLower()):$Value"
  if ($config -and $config.token) { Write-Host "  Schlüssel: $($config.token)" }
  Write-Host ''
}

# --- Uninstall -------------------------------------------------------------------
if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Info 'Autostart entfernt.'
  }
  $config = Read-AgentConfig
  Stop-RunningAgent $(if ($config -and $config.port) { [int]$config.port } else { $DefaultPort })
  if (Get-NetFirewallRule -DisplayName $FirewallRule -ErrorAction SilentlyContinue) {
    if (Test-Admin) {
      Remove-NetFirewallRule -DisplayName $FirewallRule
      Write-Info 'Firewall-Regel entfernt.'
    } else {
      Write-Warn 'Die Firewall-Regel lässt sich nur als Administrator entfernen.'
    }
  }
  Write-Info "Die Einstellungen in $dataDir bleiben erhalten; lösche den Ordner, um auch den Schlüssel zu verwerfen."
  exit 0
}

# --- Port --------------------------------------------------------------------
if ($Port) { Save-AgentPort $Port }
$config = Read-AgentConfig
$agentPort = if ($config -and $config.port) { [int]$config.port } else { $DefaultPort }

$checkoutVersion = Get-CheckoutVersion
if ((Test-PortInUse $agentPort) -and -not $Install) {
  $running = Get-RunningAgentVersion $agentPort
  if ($running -eq $checkoutVersion) {
    Write-Info "Der Agent $running läuft schon auf Port $agentPort (Autostart)."
    Show-Connection $agentPort
    exit 0
  }
  if ($null -ne $running) {
    $which = if ($running) { "Version $running" } else { 'eine ältere Version' }
    Write-Warn "Auf Port $agentPort läuft noch ein anderer Agent ($which), in diesem Ordner liegt Version $checkoutVersion. Zum Ersetzen: scripts\start-agent.cmd -Install (als Administrator) – das beendet den laufenden Agent und startet den neuen."
  } else {
    Write-Warn "Port $agentPort ist durch ein anderes Programm belegt. Einen anderen Port wählen: scripts\start-agent.cmd -Port 8791"
  }
  exit 1
}

# --- Tools -------------------------------------------------------------------
$jellyfinFfmpeg = Join-Path $env:ProgramFiles 'Jellyfin\Server\ffmpeg.exe'
if (Test-Path $jellyfinFfmpeg) {
  Write-Info "Verwende das ffmpeg von Jellyfin ($jellyfinFfmpeg)."
} elseif (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
  Write-Info "ffmpeg ist vorhanden ($((Get-Command ffmpeg).Source))."
} else {
  Install-WingetPackage 'Gyan.FFmpeg' 'ffmpeg'
}

$mkvmerge = Join-Path $env:ProgramFiles 'MKVToolNix\mkvmerge.exe'
if ((Test-Path $mkvmerge) -or (Get-Command mkvmerge -ErrorAction SilentlyContinue)) {
  Write-Info 'MKVToolNix ist vorhanden.'
} else {
  Install-WingetPackage 'MKVToolNix.MKVToolNix' 'MKVToolNix'
}

$doviTool = Join-Path $toolsDir 'dovi_tool.exe'
if (Test-Path $doviTool) {
  Write-Info 'dovi_tool ist vorhanden.'
} else {
  Write-Info "Lade dovi_tool $DoviToolVersion herunter …"
  # Windows PowerShell 5.1 may not offer TLS 1.2 by default, which GitHub requires.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $zip = Join-Path $env:TEMP "dovi_tool-$DoviToolVersion.zip"
  $download = "https://github.com/quietvoid/dovi_tool/releases/download/$DoviToolVersion/dovi_tool-$DoviToolVersion-x86_64-pc-windows-msvc.zip"
  try {
    Invoke-WebRequest $download -OutFile $zip -UseBasicParsing
  } catch {
    Stop-WithError "dovi_tool konnte nicht geladen werden: $($_.Exception.Message)"
  }
  $hash = (Get-FileHash $zip -Algorithm SHA256).Hash
  if ($hash -ne $DoviToolSha256) {
    Remove-Item $zip -Force
    Stop-WithError "Die Prüfsumme von dovi_tool stimmt nicht ($hash) – die Datei wurde verworfen."
  }
  New-Item -ItemType Directory -Force $toolsDir | Out-Null
  Expand-Archive $zip -DestinationPath $toolsDir -Force
  Remove-Item $zip -Force
  Write-Info "dovi_tool liegt in $toolsDir."
}

# --- Node.js, dependencies and build -------------------------------------------
Initialize-Node
$npm = Get-Npm
Install-Dependencies $npm

Write-Info 'Baue den Agent …'
Invoke-Native { & $npm --silent run build -w agent }
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Der Build ist fehlgeschlagen (siehe oben).' }

# --- Autostart and firewall ----------------------------------------------------
if ($Install) {
  if (Test-Admin) {
    if (-not (Get-NetFirewallRule -DisplayName $FirewallRule -ErrorAction SilentlyContinue)) {
      New-NetFirewallRule -DisplayName $FirewallRule -Direction Inbound -Protocol TCP -LocalPort $agentPort -Action Allow -Profile Private, Domain | Out-Null
      Write-Info "Firewall: Port $agentPort im privaten Netzwerk freigegeben."
    }
  } else {
    Write-Warn "Für die Firewall-Freigabe von Port $agentPort braucht es Administratorrechte: das Skript einmal als Administrator ausführen (Rechtsklick auf start-agent.cmd)."
  }

  Save-ToolPaths @{ ffmpeg = $jellyfinFfmpeg; ffprobe = (Join-Path $env:ProgramFiles 'Jellyfin\Server\ffprobe.exe'); mkvmerge = $mkvmerge }

  $node = (Get-Command node).Source
  # run-agent.ps1 starts the agent and starts it again when Manelly asks for a restart or an update. A hidden
  # PowerShell keeps its window out of sight; the agent writes agent\data\agent.log itself. --autostart (via
  # -Autostart): the agent tells Manelly it was started this way.
  $runner = Join-Path $PSScriptRoot 'run-agent.ps1'
  $runnerArguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`" -Node `"$node`" -Autostart"
  $user = "$env:USERDOMAIN\$env:USERNAME"
  $taskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  $task = @{ TaskName = $TaskName; Settings = $taskSettings; Description = 'Manelly-Agent: wandelt auf Anfrage von Manelly Dateien um.'; Force = $true }

  if (Test-Admin) {
    # With Windows, before anybody logs on – e.g. after a nightly restart.
    $task.Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $runnerArguments -WorkingDirectory $root
    $task.Trigger = New-ScheduledTaskTrigger -AtStartup
    # Network drives (Z:) need the stored password: without a logon, Windows has no credentials for the network.
    # The agent connects them itself; this only asks whether it may log on with the password.
    $networkDrives = @(Get-ChildItem 'HKCU:\Network' -ErrorAction SilentlyContinue | ForEach-Object { "$($_.PSChildName.ToUpper()): $((Get-ItemProperty $_.PSPath).RemotePath)" })
    if (-not $StorePassword -and $networkDrives.Count) {
      Write-Warn "Du hast Netzlaufwerke ($($networkDrives -join ', ')). Ohne Anmeldung erreicht der Agent sie nur mit deinem gespeicherten Windows-Passwort."
      $answer = Read-Host 'Passwort jetzt für den Autostart speichern? [J/n]'
      if ($answer -notmatch '^\s*(n|nein|no)\s*$') { $StorePassword = $true }
    }
    if ($StorePassword) {
      $credential = Get-Credential -UserName $user -Message 'Windows-Passwort für den Autostart des Agents (für Medien auf Netzwerkfreigaben)'
      if (-not $credential) { Stop-WithError 'Abgebrochen – ohne Passwort kein Autostart mit Zugriff auf Netzwerkfreigaben.' }
      $task.User = $credential.UserName
      $task.Password = $credential.GetNetworkCredential().Password
      $startsWhen = 'mit Windows, auch ohne Anmeldung (mit gespeichertem Passwort, Netzlaufwerke und Netzwerkfreigaben erreichbar)'
    } else {
      # S4U: runs as this user without a stored password; reaches local drives, but no network shares.
      $task.Principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
      $startsWhen = 'mit Windows, auch ohne Anmeldung'
    }
  } else {
    Write-Warn 'Ohne Administratorrechte startet der Agent erst, wenn du dich anmeldest. Damit er mit Windows startet (z. B. nach einem nächtlichen Neustart), das Skript als Administrator ausführen.'
    $task.Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $runnerArguments -WorkingDirectory $root
    $task.Trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $startsWhen = "bei jeder Anmeldung von $env:USERNAME"
  }

  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
  Stop-RunningAgent $agentPort
  try {
    Register-ScheduledTask @task | Out-Null
  } catch {
    Stop-WithError "Der Autostart liess sich nicht einrichten: $($_.Exception.Message)"
  }
  Start-ScheduledTask -TaskName $TaskName
  Write-Info "Autostart eingerichtet: Der Agent startet $startsWhen."
  if (Wait-AgentHealthy $agentPort $checkoutVersion) {
    Write-Info "Der Agent $checkoutVersion läuft auf Port $agentPort."
  } else {
    Write-Warn "Der Agent $checkoutVersion antwortet noch nicht – siehe $(Join-Path $dataDir 'agent.log')."
  }
  Show-Connection $agentPort
  exit 0
}

# --- Start in this window --------------------------------------------------------
Write-Info 'Starte den Agent – beenden mit Ctrl+C.'
# Through run-agent.ps1, so Manelly can restart and update it here too.
& (Join-Path $PSScriptRoot 'run-agent.ps1') -Node (Get-Command node).Source
exit $LASTEXITCODE
