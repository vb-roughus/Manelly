# Behind the desktop icon «Manelly» (see install-windows.ps1): opens Manelly in the
# browser – and when it is not running yet, starts it first, hidden in the background
# (start-windows.ps1 -Background), while a small window shows how far it is. When the
# start fails, the window says why. A second click while it starts waits for the first.
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
$serverLog = Join-Path $data 'manelly.log'
$errorLog = Join-Path $data 'manelly-error.log'
$startLog = Join-Path $data 'manelly-start.log'
# Up to this long for the first answer: starting takes a few seconds, the media index longer, but it answers before.
$WaitSeconds = 90
$launchedAt = Get-Date

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# Without a window of its own, a message box is the only way to say something.
function Show-Problem([string]$Message) {
  $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
  try {
    [void][System.Windows.Forms.MessageBox]::Show($owner, $Message, 'Manelly', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning)
  } finally {
    $owner.Dispose()
  }
}

# An unexpected error shows too – hidden as this script runs, nothing else would.
trap {
  Show-Problem "Manelly liess sich nicht öffnen: $($_.Exception.Message)"
  exit 1
}

# Lets the window draw and answer clicks while this script waits.
function Wait-Responsive([int]$Milliseconds) {
  $until = (Get-Date).AddMilliseconds($Milliseconds)
  do {
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 50
  } while ((Get-Date) -lt $until)
}

# The small window while Manelly starts: a title, a running bar and what Manelly does right now. Null when it cannot
# be shown – starting works without it.
function New-StatusWindow {
  try {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'Manelly'
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    $form.MaximizeBox = $false
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $form.ClientSize = New-Object System.Drawing.Size(440, 140)
    $form.Font = New-Object System.Drawing.Font('Segoe UI', 9)
    $form.TopMost = $true
    $icon = Join-Path $PSScriptRoot 'manelly.ico'
    if (Test-Path $icon) { $form.Icon = New-Object System.Drawing.Icon($icon) }

    $title = New-Object System.Windows.Forms.Label
    $title.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
    $title.SetBounds(16, 14, 408, 24)
    $title.Text = 'Manelly wird gestartet …'

    $bar = New-Object System.Windows.Forms.ProgressBar
    $bar.Style = [System.Windows.Forms.ProgressBarStyle]::Marquee
    $bar.MarqueeAnimationSpeed = 30
    $bar.SetBounds(16, 46, 408, 12)

    $status = New-Object System.Windows.Forms.Label
    $status.ForeColor = [System.Drawing.Color]::DimGray
    $status.SetBounds(16, 68, 408, 60)
    $status.Text = 'Starte im Hintergrund …'

    # Event handlers run after this function is gone: what they need comes with the button ($this).
    $logButton = New-Object System.Windows.Forms.Button
    $logButton.Text = 'Log öffnen'
    $logButton.SetBounds(220, 0, 108, 28)
    $logButton.Visible = $false
    $logButton.Add_Click({
        try { Start-Process -FilePath 'notepad.exe' -ArgumentList "`"$($this.Tag)`"" } catch { }
      })

    $closeButton = New-Object System.Windows.Forms.Button
    $closeButton.Text = 'Schliessen'
    $closeButton.SetBounds(336, 0, 88, 28)
    $closeButton.Visible = $false
    $closeButton.Add_Click({ $this.FindForm().Close() })

    $form.Controls.AddRange(@($title, $bar, $status, $logButton, $closeButton))
    $form.Show()
    [System.Windows.Forms.Application]::DoEvents()
    return @{ Form = $form; Title = $title; Bar = $bar; Status = $status; Log = $logButton; Close = $closeButton }
  } catch {
    return $null
  }
}

function Test-WindowOpen($ui) {
  return $ui -and -not $ui.Form.IsDisposed -and $ui.Form.Visible
}

# Lines a file got since this launch, without empty ones – none when it is older, missing or cannot be read. Manelly
# still writes to its logs: they are read without locking them.
function Get-FreshLines([string]$Path) {
  try {
    if (-not (Test-Path -LiteralPath $Path)) { return @() }
    if ((Get-Item -LiteralPath $Path).LastWriteTime -lt $launchedAt.AddSeconds(-2)) { return @() }
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
      $text = (New-Object System.IO.StreamReader($stream)).ReadToEnd()
    } finally {
      $stream.Dispose()
    }
    return @($text -split "`r?`n" | Where-Object { $_.Trim() } | ForEach-Object { if ($_.Length -gt 200) { $_.Substring(0, 200) + ' …' } else { $_ } })
  } catch {
    return @()
  }
}

# What Manelly does right now: its last log message, else what the starter said last.
function Get-StartStatus {
  $server = @(Get-FreshLines $serverLog)
  if ($server.Count -gt 0) {
    $message = $null
    # Manelly logs one JSON object per line; its text is in "msg".
    try { $message = ($server[-1] | ConvertFrom-Json).msg } catch { }
    if ($message) { return [string]$message }
  }
  $starter = @(Get-FreshLines $startLog)
  if ($starter.Count -gt 0) { return ($starter[-1] -replace '^[>!] ', '') }
  return 'Starte im Hintergrund …'
}

# Why the start ended: what the starter said went wrong, and the end of Manelly's error log.
function Get-FailureReason {
  $parts = @()
  $said = @(Get-FreshLines $startLog | Where-Object { $_ -like '! *' } | ForEach-Object { $_.Substring(2) })
  if ($said.Count -gt 0) { $parts += ($said -join "`n") }
  $errors = @(Get-FreshLines $errorLog | Select-Object -Last 8)
  if ($errors.Count -gt 0) { $parts += "Aus manelly-error.log:`n" + ($errors -join "`n") }
  if ($parts.Count -eq 0) { return 'Dazu gibt es keine Meldung.' }
  return ($parts -join "`n`n")
}

# The log worth opening after a failed start: the first one that got lines since this launch.
function Get-FailureLog {
  foreach ($path in @($errorLog, $startLog, $serverLog)) {
    if (@(Get-FreshLines $path).Count -gt 0) { return $path }
  }
  return $null
}

# Until Manelly answers: 'open'; 'ended' when the starter ended before; 'failed' after $WaitSeconds.
function Wait-ForManelly($starter, $ui) {
  $since = Get-Date
  while (((Get-Date) - $since).TotalSeconds -lt $WaitSeconds) {
    if (Test-ManellyRunning $Port) { return 'open' }
    if ($starter.HasExited) { return 'ended' }
    if (Test-WindowOpen $ui) {
      $seconds = [int]((Get-Date) - $since).TotalSeconds
      $ui.Status.Text = "$(Get-StartStatus)`n`nseit $seconds s"
    }
    Wait-Responsive 500
  }
  return 'failed'
}

# Says in the window why Manelly did not start – or in a message box, without one – and waits until it is closed.
function Show-Failure($ui, [string]$Title, [string]$Text, [string]$LogFile) {
  if (-not (Test-WindowOpen $ui)) {
    Show-Problem "$Title`n`n$Text"
    return
  }
  $ui.Title.Text = $Title
  $ui.Title.ForeColor = [System.Drawing.Color]::Firebrick
  $ui.Bar.Visible = $false
  $ui.Status.ForeColor = [System.Drawing.SystemColors]::ControlText
  $ui.Status.SetBounds(16, 46, 408, 200)
  $ui.Status.Text = $Text
  $ui.Form.ClientSize = New-Object System.Drawing.Size(440, 300)
  $ui.Log.Top = 258
  $ui.Log.Tag = $LogFile
  $ui.Log.Visible = [bool]$LogFile
  $ui.Close.Top = 258
  $ui.Close.Visible = $true
  $ui.Form.AcceptButton = $ui.Close
  $ui.Form.Activate()
  while (Test-WindowOpen $ui) { Wait-Responsive 100 }
}

# One launcher at a time: a second click waits for the first one, then finds Manelly running.
$ui = $null
$result = 'open'
$mutex = New-Object System.Threading.Mutex($false, 'Local\ManellyLaunch')
try {
  [void]$mutex.WaitOne()
} catch [System.Threading.AbandonedMutexException] {
  # The other launcher ended without letting go; the mutex is ours now.
}
try {
  if (-not (Test-ManellyRunning $Port)) {
    $ui = New-StatusWindow
    if (Test-PortInUse $Port) {
      $result = 'port'
    } else {
      $powershell = Join-Path $PSHOME 'powershell.exe'
      $starterScript = Join-Path $PSScriptRoot 'start-windows.ps1'
      # Quoted by hand: Windows PowerShell does not quote the arguments of Start-Process.
      $starter = Start-Process -FilePath $powershell -WindowStyle Hidden -WorkingDirectory $root -PassThru -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$starterScript`"", '-Background')
      # Holding its handle keeps HasExited telling the truth once it ended.
      $null = $starter.Handle
      $result = Wait-ForManelly $starter $ui
    }
  }
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}

$logs = "Mehr dazu in:`n$serverLog`n$errorLog"
switch ($result) {
  'open' {
    if (Test-WindowOpen $ui) {
      $ui.Title.Text = 'Manelly läuft – der Browser öffnet sich …'
      Wait-Responsive 700
      $ui.Form.Close()
    }
    if (-not $NoBrowser) { Start-Process $url }
  }
  'port' {
    Show-Failure $ui "Port $Port ist belegt" "Ein anderes Programm belegt Port $Port – Manelly kann dort nicht starten.`n`nEinen anderen Port wählen: im Manelly-Ordner ($root) in der Datei .env die Zeile PORT=3001 eintragen, oder den Installer mit -Port 3001 nochmals ausführen." $null
    exit 1
  }
  'ended' {
    Show-Failure $ui 'Manelly hat sich gleich wieder beendet' "$(Get-FailureReason)`n`n$logs" (Get-FailureLog)
    exit 1
  }
  default {
    Show-Failure $ui 'Manelly antwortet nicht' "Nach $WaitSeconds Sekunden kam keine Antwort. Vielleicht startet es trotzdem noch – dann öffnet $url es.`n`n$(Get-FailureReason)`n`n$logs" (Get-FailureLog)
    exit 1
  }
}
