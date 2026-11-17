# Falcon's hands for Windows apps: open any installed app by name, bring an open one to the front,
# list what is open, or ask an app to close the normal way. Prints one line of JSON.
#   powershell -NoProfile -ExecutionPolicy Bypass -File apps.ps1 -Do open -Name "Telegram"
#   powershell -NoProfile -ExecutionPolicy Bypass -File apps.ps1 -Do focus -Name "Telegram"
#   powershell -NoProfile -ExecutionPolicy Bypass -File apps.ps1 -Do running
#   powershell -NoProfile -ExecutionPolicy Bypass -File apps.ps1 -Do installed [-Name "part of a name"]
#   powershell -NoProfile -ExecutionPolicy Bypass -File apps.ps1 -Do close -Name "Notepad"
# Apps are found the way the Start menu lists them, so desktop and Store apps both work. Uninstallers,
# setup and repair entries are never started.
param(
  [ValidateSet("open", "focus", "running", "installed", "close")][string]$Do = "open",
  [string]$Name = ""
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Say($object) { Write-Output ($object | ConvertTo-Json -Compress -Depth 4); exit 0 }
function Fail([string]$message) { Write-Output (@{ ok = $false; error = $message } | ConvertTo-Json -Compress); exit 1 }

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class FalconWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@

$unsafe = '(?i)\b(uninstall|uninstaller|setup|repair|remove|deinstall|unins\d*)\b|unins\d*\.exe'
function Installed {
  Get-StartApps | Where-Object { $_.Name -notmatch $unsafe -and $_.AppID -notmatch $unsafe }
}
function Find-App([string]$want) {
  $apps = @(Installed)
  $w = $want.Trim()
  $hit = $apps | Where-Object { $_.Name -ieq $w } | Select-Object -First 1
  if (-not $hit) { $hit = $apps | Where-Object { $_.Name -like "$w*" } | Sort-Object { $_.Name.Length } | Select-Object -First 1 }
  if (-not $hit) { $hit = $apps | Where-Object { $_.Name -like "*$w*" } | Sort-Object { $_.Name.Length } | Select-Object -First 1 }
  return $hit
}
function Windows {
  Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } |
    Select-Object @{ n = "app"; e = { $_.ProcessName } }, @{ n = "title"; e = { $_.MainWindowTitle } }, Id, MainWindowHandle
}
function Find-Window([string]$want) {
  $w = $want.Trim()
  $all = @(Windows)
  $hit = $all | Where-Object { $_.app -ieq $w -or $_.app -ieq ($w -replace '\s', '') } | Select-Object -First 1
  if (-not $hit) { $hit = $all | Where-Object { $_.app -like "*$($w -replace '\s', '')*" -or $_.title -like "*$w*" } | Select-Object -First 1 }
  return $hit
}
function Bring-Front($window) {
  $h = [IntPtr]$window.MainWindowHandle
  if ([FalconWin]::IsIconic($h)) { [void][FalconWin]::ShowWindow($h, 9) }
  # Windows only lets the app that last had input take the front; a tap of Alt counts as input.
  [FalconWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [FalconWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  [void][FalconWin]::SetForegroundWindow($h)
}

switch ($Do) {
  "running" {
    Say @{ ok = $true; windows = @(Windows | ForEach-Object { @{ app = $_.app; title = $_.title } }) }
  }
  "installed" {
    $list = @(Installed | Where-Object { -not $Name -or $_.Name -like "*$Name*" } | ForEach-Object { $_.Name } | Sort-Object -Unique)
    Say @{ ok = $true; count = $list.Count; apps = @($list | Select-Object -First 60) }
  }
  "focus" {
    if (-not $Name) { Fail "Say which app to bring to the front." }
    $win = Find-Window $Name
    if (-not $win) { Fail "$Name has no open window. Open it first." }
    Bring-Front $win
    Say @{ ok = $true; app = $win.app; title = $win.title }
  }
  "close" {
    if (-not $Name) { Fail "Say which app to close." }
    $win = Find-Window $Name
    if (-not $win) { Say @{ ok = $true; closed = $false; note = "$Name was not open." } }
    $p = Get-Process -Id $win.Id
    [void]$p.CloseMainWindow()
    Start-Sleep -Seconds 3
    $p.Refresh()
    if ($p.HasExited) { Say @{ ok = $true; closed = $true; app = $win.app } }
    Say @{ ok = $true; closed = $false; app = $win.app; note = "It is still open; it is probably asking whether to save." }
  }
  "open" {
    if (-not $Name) { Fail "Say which app to open." }
    $already = Find-Window $Name
    if ($already) { Bring-Front $already; Say @{ ok = $true; app = $already.app; title = $already.title; alreadyOpen = $true } }
    $app = Find-App $Name
    if (-not $app) {
      $close = @(Installed | Where-Object { $_.Name -like "*$($Name.Substring(0, [Math]::Min(3, $Name.Length)))*" } | Select-Object -First 5 | ForEach-Object { $_.Name })
      Fail ("No app called $Name is installed." + $(if ($close.Count) { " Similar: " + ($close -join ", ") + "." } else { "" }))
    }
    Start-Process explorer.exe -ArgumentList "shell:AppsFolder\$($app.AppID)"
    # Wait for its window, then bring it to the front so the next step can work in it.
    $win = $null
    $words = @($app.Name -split '\s+' | Where-Object { $_.Length -gt 2 })
    for ($i = 0; $i -lt 30 -and -not $win; $i++) {
      Start-Sleep -Milliseconds 500
      foreach ($w in @($app.Name) + $words) { if (-not $win) { $win = Find-Window $w } }
    }
    if ($win) { Bring-Front $win; Say @{ ok = $true; app = $app.Name; title = $win.title; started = $true } }
    Say @{ ok = $true; app = $app.Name; started = $true; note = "Started; its window has not appeared yet. Look at the screen before the next step." }
  }
}
