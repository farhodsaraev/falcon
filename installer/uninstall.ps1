# Removes Falcon from this Windows computer. No administrator rights needed.
#
# Started by "Uninstall" in Settings > Apps, by the Uninstall button in Falcon's own Settings, or by hand:
#   powershell -ExecutionPolicy Bypass -File uninstall.ps1 [-DeleteData | -KeepData] [-Quiet]
#
# It removes Falcon's app, his icons, his entry in Settings > Apps, the engine he runs on and its
# start-at-sign-in entry. What Falcon remembers about the user and the AI key are removed only when
# the user agrees (or -DeleteData is given). Node.js is removed only if Falcon's installer put it there.
param(
  [string]$InstallDir = "",
  [switch]$DeleteData,
  [switch]$KeepData,
  [switch]$Quiet,          # ask nothing
  [switch]$NoMessage,      # and show no closing message
  [switch]$Relaunched
)
$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"
# Normally <install folder>\app\installer\uninstall.ps1. Anywhere else (for example a copy of the project
# code), use the standard install folder: never derive a folder to delete from an unexpected place.
if (-not $InstallDir) {
  $parent = Split-Path $PSScriptRoot -Parent
  if ((Split-Path $parent -Leaf) -eq "app" -and (Test-Path (Join-Path $parent "src\app\launch.js"))) { $InstallDir = Split-Path $parent -Parent }
  else { $InstallDir = Join-Path $env:LOCALAPPDATA "Falcon" }
}
$windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$app = Join-Path $InstallDir "app"

# This script lives inside the folder it removes: run from a copy in the temporary folder instead.
if (-not $Relaunched -and $PSCommandPath -like "$InstallDir*") {
  $copy = Join-Path $env:TEMP ("falcon-uninstall-" + [guid]::NewGuid().ToString().Substring(0, 8) + ".ps1")
  Copy-Item $PSCommandPath $copy -Force
  $pass = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", "`"$copy`"", "-InstallDir", "`"$InstallDir`"", "-Relaunched")
  if ($DeleteData) { $pass += "-DeleteData" }
  if ($KeepData) { $pass += "-KeepData" }
  if ($Quiet) { $pass += "-Quiet" }
  if ($NoMessage) { $pass += "-NoMessage" }
  Start-Process $windowsPowerShell -ArgumentList $pass -WindowStyle Hidden
  exit 0
}

# What happened, step by step, in case the removal stops part way (seen once: "nothing happened").
try { Start-Transcript -Path (Join-Path $env:TEMP "falcon-uninstall.log") -Force | Out-Null } catch { }

Add-Type -AssemblyName System.Windows.Forms
# The questions come from a hidden window, so Windows may put them behind Falcon's window, where the user never
# sees them and the removal seems to do nothing. An invisible top-most owner keeps them in front.
function Ask([string]$text, [string]$buttons, [string]$default = "Button1") {
  $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; WindowState = "Minimized" }
  try { return [System.Windows.Forms.MessageBox]::Show($owner, $text, "Falcon", $buttons, "Question", $default).ToString() }
  finally { $owner.Dispose() }
}

# ---- Ask first (unless told exactly what to do) ----
if (-not $Quiet) {
  if ((Ask "Remove Falcon from this computer?" "OKCancel") -ne "OK") { exit 0 }
}
if (-not $DeleteData -and -not $KeepData) {
  if ($Quiet) { $KeepData = $true }
  else {
    $answer = Ask ("Also delete what Falcon remembers about you, your conversations, his connections (such as Telegram) and your AI key?`n`n" +
      "Yes: delete everything.`nNo: keep them, so a reinstalled Falcon still knows you.") "YesNo" "Button2"
    if ($answer -eq "Yes") { $DeleteData = $true } else { $KeepData = $true }
  }
}

# ---- 1. Close Falcon: his window, his icon among the hidden icons, his window server ----
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.ProcessId -ne $PID -and $_.CommandLine -and (
    $_.CommandLine -like "*$app*" -or $_.CommandLine -like "*\.falcon\window*" -or $_.CommandLine -like "*falcon*tray.ps1*" -or $_.CommandLine -like "*\.falcon\watchdog.mjs*")
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# ---- 2. The engine: its start-at-sign-in entry, then the engine itself ----
$engineCmd = (Get-Command openclaw.cmd -ErrorAction SilentlyContinue).Source
foreach ($dir in @((Join-Path $env:LOCALAPPDATA "Programs\nodejs"), (Join-Path $env:APPDATA "npm"), (Join-Path $env:USERPROFILE ".local\bin"))) {
  if (-not $engineCmd -and (Test-Path (Join-Path $dir "openclaw.cmd"))) { $engineCmd = Join-Path $dir "openclaw.cmd" }
}
# The engine keeps its files in Falcon's folder, reached through a hidden .openclaw link, under Falcon's
# start-up name (src/app/enginehome.js); an older install has a real .openclaw folder under the engine's
# own name. Tell the engine which, then remove both.
$oldHome = Join-Path $env:USERPROFILE ".openclaw"
$linked = (Test-Path $oldHome) -and ((Get-Item $oldHome -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)
foreach ($name in "OPENCLAW_STATE_DIR", "OPENCLAW_CONFIG_PATH", "OPENCLAW_PROFILE", "OPENCLAW_HOME") { Remove-Item "env:$name" -ErrorAction SilentlyContinue }
if ($linked) { $env:OPENCLAW_WINDOWS_TASK_NAME = "Falcon Engine" } else { Remove-Item env:OPENCLAW_WINDOWS_TASK_NAME -ErrorAction SilentlyContinue }
if ($engineCmd) {
  & $engineCmd uninstall --service --yes --non-interactive *> $null
}
# Stop whatever is still running of the engine, then remove its start-at-sign-in leftovers.
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.ProcessId -ne $PID -and $_.CommandLine -and ($_.CommandLine -like "*node_modules\openclaw*" -or $_.CommandLine -like "*\.openclaw\gateway.cmd*" -or $_.CommandLine -like "*OpenClaw Gateway.vbs*" -or
    $_.CommandLine -like "*\.falcon\engine\gateway.cmd*" -or $_.CommandLine -like "*Falcon Engine.vbs*")
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
$startup = [Environment]::GetFolderPath("Startup")
foreach ($name in "OpenClaw Gateway", "Falcon Engine") {
  Remove-Item (Join-Path $startup "$name.vbs") -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $startup "$name.cmd") -Force -ErrorAction SilentlyContinue
  schtasks /delete /tn $name /f *> $null
}
foreach ($name in "OPENCLAW_STATE_DIR", "OPENCLAW_WINDOWS_TASK_NAME") { [Environment]::SetEnvironmentVariable($name, $null, "User") }
if ($engineCmd) {
  $engineDir = Split-Path $engineCmd -Parent
  $npm = Join-Path $engineDir "npm.cmd"
  if (Test-Path $npm) { & $npm uninstall -g openclaw --loglevel=error *> $null }
  # Whatever npm did not remove
  Remove-Item (Join-Path $engineDir "node_modules\openclaw") -Recurse -Force -ErrorAction SilentlyContinue
  foreach ($shim in "openclaw", "openclaw.cmd", "openclaw.ps1") { Remove-Item (Join-Path $engineDir $shim) -Force -ErrorAction SilentlyContinue }
}

# ---- 3. Node.js, only if Falcon's installer put it there ----
$nodeMarker = Join-Path $InstallDir "node-installed-by-falcon.txt"
if (Test-Path $nodeMarker) {
  $nodeDir = (Get-Content $nodeMarker -Raw).Trim()
  if ($nodeDir -and (Test-Path (Join-Path $nodeDir "node.exe"))) {
    Remove-Item $nodeDir -Recurse -Force -ErrorAction SilentlyContinue
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $kept = ($userPath -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ne $nodeDir.TrimEnd('\') }) -join ';'
    [Environment]::SetEnvironmentVariable("Path", $kept, "User")
  }
}

# ---- 3b. The portable Git Falcon installed for his workshop, only if he installed it ----
$falconGit = Join-Path $env:USERPROFILE ".falcon\git"
if (Test-Path (Join-Path $falconGit "installed-by-falcon.txt")) { Remove-Item $falconGit -Recurse -Force -ErrorAction SilentlyContinue }
# A repair's engine copy links to the engine's libraries. Windows PowerShell deletes through such a link,
# so each link is removed on its own first (rmdir removes only the link).
Get-ChildItem (Join-Path $env:USERPROFILE ".falcon\workshops") -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
  $libs = Join-Path $_.FullName ".engine-copy\node_modules"
  if (Test-Path $libs) { cmd /c rmdir "$libs" *> $null }
}
# The coding tool (Codex), the private engine settings Falcon's repairs used, and his checks of add-ons and
# engine patches: always his own.
foreach ($own in "tools", "codex-home", "repair-engine", "addon-check", "engine-copy-check") { Remove-Item (Join-Path $env:USERPROFILE ".falcon\$own") -Recurse -Force -ErrorAction SilentlyContinue }

# ---- 4. Falcon's icons, his entry in Settings > Apps, and his files ----
foreach ($link in @(
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "Falcon.lnk"),
    (Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs\Falcon.lnk"),
    (Join-Path $startup "Falcon.lnk"))) {
  Remove-Item $link -Force -ErrorAction SilentlyContinue
}
Remove-Item "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Falcon" -Recurse -Force -ErrorAction SilentlyContinue
# Only Falcon's own app folder and the notes his installer left beside it; the folder itself only if
# that leaves it empty.
foreach ($try in 1..5) {
  Remove-Item (Join-Path $InstallDir "app") -Recurse -Force -ErrorAction SilentlyContinue
  if (-not (Test-Path (Join-Path $InstallDir "app"))) { break }
  Start-Sleep -Seconds 2
}
Remove-Item (Join-Path $InstallDir "node-installed-by-falcon.txt") -Force -ErrorAction SilentlyContinue
if ((Test-Path $InstallDir) -and -not (Get-ChildItem $InstallDir -Force -ErrorAction SilentlyContinue)) { Remove-Item $InstallDir -Force -ErrorAction SilentlyContinue }

# ---- 5. What Falcon knows, only if the user agreed ----
if ($DeleteData) {
  # After the move, .openclaw is only a link to Falcon's folder: remove the link itself, not through it.
  if ($linked) { cmd /c rmdir "$oldHome" *> $null }
  foreach ($dir in @((Join-Path $env:USERPROFILE ".openclaw"), (Join-Path $env:USERPROFILE ".falcon"), (Join-Path $env:LOCALAPPDATA "openclaw"),
      (Join-Path ([Environment]::GetFolderPath("MyDocuments")) "Falcon Samples"))) {
    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$left = @((Join-Path $InstallDir "app")) | Where-Object { Test-Path $_ }
if (-not $NoMessage) {
  $done = if ($left) { "Falcon has been removed, but some files were still in use. You can delete this folder by hand:`n$($left -join "`n")" }
    else { "Falcon has been removed." + $(if ($KeepData) { " What he remembers about you was kept." } else { "" }) }
  $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; WindowState = "Minimized" }
  [void][System.Windows.Forms.MessageBox]::Show($owner, $done, "Falcon", "OK", "Information")
  $owner.Dispose()
}
try { Stop-Transcript | Out-Null } catch { }
if ($Relaunched) { Remove-Item $PSCommandPath -Force -ErrorAction SilentlyContinue }
exit 0
