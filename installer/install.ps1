# Falcon installer for Windows. No administrator rights needed.
#
# One line, pasted into PowerShell:
#   irm https://raw.githubusercontent.com/farhodsaraev/falcon/main/installer/install.ps1 | iex
# Or from a downloaded copy of the package:
#   powershell -ExecutionPolicy Bypass -File install.ps1
#
# It copies Falcon to this user's app folder, makes sure Node.js is present,
# puts a Falcon icon on the Desktop and in the Start menu, and opens Falcon's window.
# The window itself then asks for the AI key and finishes the setup.
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "Falcon"),
  [string]$ZipUrl = "",          # where falcon.zip is hosted
  [switch]$NoShortcuts,
  [switch]$NoLaunch
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$FalconZipUrl = if ($ZipUrl) { $ZipUrl } else { "https://github.com/farhodsaraev/falcon/archive/refs/heads/main.zip" }
function Say([string]$text) { Write-Host "  $text" }

Write-Host ""
Write-Host "  F A L C O N"
Write-Host ""

# ---- 1. Falcon's files ----
$app = Join-Path $InstallDir "app"
# Copies only what Falcon needs at run time from a package folder or a copy of the repository.
function Copy-Falcon([string]$from) {
  New-Item -ItemType Directory -Force (Join-Path $app "src") | Out-Null
  Copy-Item (Join-Path $from "src\app") (Join-Path $app "src\app") -Recurse -Force
  Copy-Item (Join-Path $from "ui") $app -Recurse -Force
  Copy-Item (Join-Path $from "falcon-agent") $app -Recurse -Force
  $icon = @("falcon.ico", "installer\falcon.ico") | ForEach-Object { Join-Path $from $_ } | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($icon) { Copy-Item $icon (Join-Path $app "falcon.ico") -Force }
  '{ "name": "falcon", "version": "0.1.0", "private": true, "type": "module" }' | Set-Content (Join-Path $app "package.json") -Encoding ascii
  # Sample files so the "things to try" work on a fresh PC
  $samples = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "Falcon Samples"
  if ((Test-Path (Join-Path $from "demo")) -and -not (Test-Path $samples) -and -not $NoShortcuts) {
    New-Item -ItemType Directory -Force $samples | Out-Null
    Get-ChildItem (Join-Path $from "demo") -File | Where-Object { $_.Name -notlike '~$*' } | Copy-Item -Destination $samples
  }
}
function Find-Package([string]$dir) {
  if (-not $dir) { return $null }
  foreach ($candidate in @($dir, (Split-Path $dir -Parent))) {
    if ($candidate -and (Test-Path (Join-Path $candidate "src\app\launch.js"))) { return $candidate }
  }
  return $null
}

$local = Find-Package $PSScriptRoot
# A running Falcon keeps his folder in use, even after his window is closed. Close him before
# replacing his files (only Falcon's own processes: those started from his folder or his window profile).
$running = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.CommandLine -and ($_.CommandLine -like "*$app*" -or $_.CommandLine -like "*\.falcon\window*") }
if ($running) {
  Say "Closing the running Falcon..."
  $running | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}
if (Test-Path $app) { Remove-Item $app -Recurse -Force }
New-Item -ItemType Directory -Force $app | Out-Null
if ($local) {
  Say "Copying Falcon..."
  Copy-Falcon $local
} else {
  Say "Downloading Falcon..."
  $zip = Join-Path $env:TEMP "falcon-package.zip"
  $unpacked = Join-Path $env:TEMP ("falcon-package-" + [guid]::NewGuid().ToString().Substring(0, 8))
  Invoke-WebRequest -UseBasicParsing $FalconZipUrl -OutFile $zip
  Expand-Archive $zip -DestinationPath $unpacked -Force
  $found = Get-ChildItem $unpacked -Recurse -Filter launch.js | Where-Object { $_.FullName -like "*\src\app\launch.js" } | Select-Object -First 1
  if (-not $found) { throw "The downloaded Falcon package is incomplete." }
  Copy-Falcon (Split-Path (Split-Path (Split-Path $found.FullName -Parent) -Parent) -Parent)
  Remove-Item $zip, $unpacked -Recurse -Force
}
if (-not (Test-Path (Join-Path $app "src\app\launch.js"))) { throw "The Falcon package is incomplete." }

# ---- 2. Node.js (official build, checksum verified, per-user) ----
function Find-Node {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "User") + ";" + [Environment]::GetEnvironmentVariable("Path", "Machine")
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $cmd) { return $null }
  $major = [int]((& $cmd.Source -v) -replace '^v(\d+)\..*', '$1')
  if ($major -ge 24) { return $cmd.Source }
  return $null
}
$node = Find-Node
if (-not $node) {
  Say "Installing Node.js..."
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
  $version = ((Invoke-RestMethod "https://nodejs.org/dist/index.json") | Where-Object { $_.lts } | Select-Object -First 1).version
  $name = "node-$version-win-$arch"
  $zip = Join-Path $env:TEMP "$name.zip"
  Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$version/$name.zip" -OutFile $zip
  $sums = (Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$version/SHASUMS256.txt").Content
  $want = ((($sums -split "`n") | Where-Object { $_ -match "$name\.zip" }) -split '\s+')[0]
  if ($want -ne (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()) { Remove-Item $zip -Force; throw "The Node.js download did not match its checksum." }
  $programs = Join-Path $env:LOCALAPPDATA "Programs"
  New-Item -ItemType Directory -Force $programs | Out-Null
  $dest = Join-Path $programs "nodejs"
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  Expand-Archive $zip -DestinationPath $programs -Force
  # Windows sometimes holds a fresh folder for a moment (antivirus scan); retry the rename briefly
  foreach ($try in 1..10) {
    try { Rename-Item (Join-Path $programs $name) "nodejs" -ErrorAction Stop; break }
    catch { if ($try -eq 10) { throw }; Start-Sleep -Seconds 2 }
  }
  Remove-Item $zip -Force
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($userPath -notlike "*$dest*") { [Environment]::SetEnvironmentVariable("Path", ($userPath.TrimEnd(';') + ";$dest"), "User") }
  $node = Join-Path $dest "node.exe"
}

# ---- 3. Icons: Desktop and Start menu. conhost --headless keeps the black console window away ----
$launch = Join-Path $app "src\app\launch.js"
if (-not $NoShortcuts) {
  Say "Adding the Falcon icon..."
  $shell = New-Object -ComObject WScript.Shell
  $places = @([Environment]::GetFolderPath("Desktop"), (Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs"))
  foreach ($place in $places) {
    $link = $shell.CreateShortcut((Join-Path $place "Falcon.lnk"))
    $link.TargetPath = Join-Path $env:SystemRoot "System32\conhost.exe"
    $link.Arguments = "--headless `"$node`" `"$launch`""
    $link.WorkingDirectory = $app
    $link.IconLocation = (Join-Path $app "falcon.ico")
    $link.Description = "Falcon, your private assistant"
    $link.Save()
  }
}

# ---- 4. Open Falcon ----
Say "Done."
if (-not $NoLaunch) {
  Say "Opening Falcon..."
  Start-Process (Join-Path $env:SystemRoot "System32\conhost.exe") -ArgumentList "--headless `"$node`" `"$launch`"" -WorkingDirectory $app
}
Write-Host ""
