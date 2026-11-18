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
  [ValidateSet("open", "focus", "running", "installed", "close", "type", "click", "keys", "scroll", "wallpaper")][string]$Do = "open",
  [string]$Path = "",            # for -Do wallpaper: a picture file to use; without it, the next built-in picture
  [string]$Name = "",
  [string]$Text = "",
  [int]$X = -1,
  [int]$Y = -1,
  [ValidateSet("left", "right", "double")][string]$Button = "left",
  [string]$Keys = "",
  [ValidateSet("up", "down")][string]$Direction = "down",
  [int]$Amount = 3,
  [int]$Times = 1               # for -Do keys: press the key this many times (volume steps)
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
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  // Windows lets only the app that has the keyboard pick the front window, so borrow its input queue
  // for a moment instead of pressing a key (Alt opens menus in some apps).
  public static void Front(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    uint mine = GetCurrentThreadId();
    uint theirs = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
    bool joined = theirs != 0 && theirs != mine && AttachThreadInput(mine, theirs, true);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    if (joined) AttachThreadInput(mine, theirs, false);
  }
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
  [FalconWin]::Front([IntPtr]$window.MainWindowHandle)
}

# Clicks and scrolls use the coordinates of the screen picture (the screen skill's screenshot, at most
# 1600 pixels wide), turned into real screen pixels here, so scaling such as 150% does not matter.
[void][FalconWin]::SetProcessDPIAware()
$screenW = [FalconWin]::GetSystemMetrics(0); $screenH = [FalconWin]::GetSystemMetrics(1)
$pictureScale = [Math]::Min(1.0, 1600 / $screenW)
function To-Screen([int]$px, [int]$py) {
  $sx = [int][Math]::Round($px / $pictureScale); $sy = [int][Math]::Round($py / $pictureScale)
  if ($px -lt 0 -or $py -lt 0 -or $sx -ge $screenW -or $sy -ge $screenH) { Fail "That point is outside the screen picture ($([int]($screenW * $pictureScale)) x $([int]($screenH * $pictureScale)))." }
  return @($sx, $sy)
}
$named = @{ enter = 0x0D; return = 0x0D; esc = 0x1B; escape = 0x1B; tab = 0x09; space = 0x20; backspace = 0x08; delete = 0x2E; del = 0x2E
  up = 0x26; down = 0x28; left = 0x25; right = 0x27; home = 0x24; end = 0x23; pageup = 0x21; pagedown = 0x22
  volumeup = 0xAF; volumedown = 0xAE; playpause = 0xB3; nexttrack = 0xB0; prevtrack = 0xB1
  f1 = 0x70; f2 = 0x71; f3 = 0x72; f4 = 0x73; f5 = 0x74; f6 = 0x75; f7 = 0x76; f8 = 0x77; f9 = 0x78; f10 = 0x79; f11 = 0x7A; f12 = 0x7B }
$mods = @{ ctrl = 0x11; control = 0x11; shift = 0x10; alt = 0x12; win = 0x5B; windows = 0x5B }

switch ($Do) {
  "wallpaper" {
    # Changes the desktop picture. With -Path, to that picture; without, to the next of the pictures that
    # come with Windows (or, with -Name, the next whose folder or file name contains those words).
    Add-Type -Namespace FalconDesk -Name Wall -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool SystemParametersInfo(uint action, uint param, string value, uint flags);'
    $current = ""
    try { $current = [string](Get-ItemProperty "HKCU:\Control Panel\Desktop" -Name WallPaper -ErrorAction Stop).WallPaper } catch { }
    if ($Path) {
      if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Fail "There is no picture at $Path." }
      if ([IO.Path]::GetExtension($Path) -notmatch '^\.(jpe?g|png|bmp)$') { Fail "That file is not a picture Windows can use as a desktop background (jpg, png or bmp)." }
      $pick = (Resolve-Path -LiteralPath $Path).Path
      $count = 1
    } else {
      $roots = @((Join-Path $env:SystemRoot "Web\Wallpaper"), (Join-Path $env:SystemRoot "Web\4K\Wallpaper")) | Where-Object { Test-Path $_ }
      $all = @($roots | ForEach-Object { Get-ChildItem -LiteralPath $_ -Recurse -File -Include *.jpg, *.jpeg, *.png -ErrorAction SilentlyContinue } |
        Where-Object { $_.Length -gt 100kb } | Sort-Object FullName)
      if ($Name) { $words = @($Name -split '\s+' | Where-Object { $_ }); $all = @($all | Where-Object { $f = $_.FullName; -not ($words | Where-Object { $f -notlike "*$_*" }) }) }
      if ($all.Count -eq 0) { Fail "I found no built-in desktop pictures on this computer." }
      $count = $all.Count
      $at = -1
      for ($i = 0; $i -lt $all.Count; $i++) { if ($all[$i].FullName -ieq $current) { $at = $i } }
      # From a picture of his own, start somewhere new each time rather than always at the first.
      if ($at -lt 0) { $at = (Get-Random -Minimum 0 -Maximum $all.Count) - 1 }
      $pick = $all[($at + 1) % $all.Count].FullName
    }
    if (-not [FalconDesk.Wall]::SystemParametersInfo(20, 0, $pick, 3)) { Fail "Windows did not accept that picture." }
    Say @{ ok = $true; picture = $pick; name = [IO.Path]::GetFileNameWithoutExtension($pick); set = (Split-Path (Split-Path $pick -Parent) -Leaf); previous = $current; choices = $count }
  }
  "click" {
    if ($X -lt 0 -or $Y -lt 0) { Fail "Give the point to click as -X and -Y from the screen picture." }
    $p = To-Screen $X $Y
    [void][FalconWin]::SetCursorPos($p[0], $p[1])
    Start-Sleep -Milliseconds 80
    $down = 0x02; $up = 0x04
    if ($Button -eq "right") { $down = 0x08; $up = 0x10 }
    $times = $(if ($Button -eq "double") { 2 } else { 1 })
    for ($i = 0; $i -lt $times; $i++) { [FalconWin]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero); [FalconWin]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60 }
    Start-Sleep -Milliseconds 400
    Say @{ ok = $true; clicked = @($X, $Y); button = $Button; note = "Take a new screen picture to see the result." }
  }
  "scroll" {
    if ($X -ge 0 -and $Y -ge 0) { $p = To-Screen $X $Y; [void][FalconWin]::SetCursorPos($p[0], $p[1]) }
    $delta = 120 * [Math]::Max(1, [Math]::Min(20, $Amount)) * $(if ($Direction -eq "up") { 1 } else { -1 })
    [FalconWin]::mouse_event(0x0800, 0, 0, $delta, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 300
    Say @{ ok = $true; scrolled = $Direction; amount = $Amount }
  }
  "keys" {
    # One key or a combination: "enter", "esc", "ctrl+f", "ctrl+shift+n", "alt+f4", "down".
    if (-not $Keys) { Fail "Say which keys to press, for example ctrl+f or enter." }
    if ($Name) { $win = Find-Window $Name; if (-not $win) { Fail "$Name has no open window." }; Bring-Front $win; Start-Sleep -Milliseconds 300 }
    $parts = @($Keys.ToLower() -split '\+' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $held = @(); $main = $null
    foreach ($k in $parts) {
      if ($mods.ContainsKey($k)) { $held += $mods[$k] }
      elseif ($named.ContainsKey($k)) { $main = $named[$k] }
      elseif ($k.Length -eq 1 -and $k -match '[a-z0-9]') { $main = [int][char]$k.ToUpper() }
      else { Fail "I do not know the key '$k'." }
    }
    if ($null -eq $main -and $held.Count -eq 0) { Fail "Say which keys to press." }
    foreach ($m in $held) { [FalconWin]::keybd_event([byte]$m, 0, 0, [UIntPtr]::Zero) }
    if ($null -ne $main) {
      for ($i = 0; $i -lt [Math]::Max(1, [Math]::Min(50, $Times)); $i++) {
        [FalconWin]::keybd_event([byte]$main, 0, 0, [UIntPtr]::Zero); [FalconWin]::keybd_event([byte]$main, 0, 2, [UIntPtr]::Zero)
        if ($Times -gt 1) { Start-Sleep -Milliseconds 30 }
      }
    }
    [array]::Reverse($held)
    foreach ($m in $held) { [FalconWin]::keybd_event([byte]$m, 0, 2, [UIntPtr]::Zero) }
    Start-Sleep -Milliseconds 300
    Say @{ ok = $true; pressed = $Keys }
  }
  "type" {
    # Puts text where the cursor is, in one go: the text goes on the clipboard, Ctrl+V pastes it, and
    # whatever the user had on the clipboard is put back. Any language, any length; it never presses Enter.
    if (-not $Text) { Fail "Say what to type." }
    if ($Name) {
      $win = Find-Window $Name
      if (-not $win) { Fail "$Name has no open window. Open it first." }
      Bring-Front $win
      Start-Sleep -Milliseconds 300
    }
    $saved = $null
    try { $saved = Get-Clipboard -Raw -ErrorAction Stop } catch { $saved = $null }
    Set-Clipboard -Value $Text
    Start-Sleep -Milliseconds 150
    [FalconWin]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero); [FalconWin]::keybd_event(0x56, 0, 0, [UIntPtr]::Zero)
    [FalconWin]::keybd_event(0x56, 0, 2, [UIntPtr]::Zero); [FalconWin]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 400
    if ($null -ne $saved) { Set-Clipboard -Value $saved } else { try { Set-Clipboard -Value $null } catch { } }
    Say @{ ok = $true; typed = $Text.Length; into = $(if ($Name) { $Name } else { "the active window" }) }
  }
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
    # Wait up to three seconds, but no longer than it takes the window to go.
    for ($i = 0; $i -lt 15; $i++) {
      Start-Sleep -Milliseconds 200
      $p.Refresh()
      if ($p.HasExited -or @(Windows | Where-Object { $_.MainWindowHandle -eq $win.MainWindowHandle }).Count -eq 0) { break }
    }
    $p.Refresh()
    # Store apps (Calculator, Photos) live inside a shared host program that never exits: what counts
    # is whether the app's own window is gone. Name such an app by what the user called it.
    $shown = $(if ($win.app -eq "ApplicationFrameHost") { $win.title } else { $win.app })
    $still = @(Windows | Where-Object { $_.MainWindowHandle -eq $win.MainWindowHandle })
    if ($p.HasExited -or $still.Count -eq 0) { Say @{ ok = $true; closed = $true; app = $shown } }
    Say @{ ok = $true; closed = $false; app = $shown; note = "It is still open; it is probably asking whether to save." }
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
    for ($i = 0; $i -lt 60 -and -not $win; $i++) {
      Start-Sleep -Milliseconds 250
      foreach ($w in @($app.Name) + $words) { if (-not $win) { $win = Find-Window $w } }
    }
    if ($win) { Bring-Front $win; Say @{ ok = $true; app = $app.Name; title = $win.title; started = $true } }
    Say @{ ok = $true; app = $app.Name; started = $true; note = "Started; its window has not appeared yet. Look at the screen before the next step." }
  }
}
