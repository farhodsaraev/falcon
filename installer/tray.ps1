# Falcon's icon among the hidden icons, next to the clock (Windows).
# Click it to open Falcon; right-click for Open and Quit. Closing Falcon's window leaves the icon here.
# Started at sign-in by the installer's Startup entry, and by Falcon's window whenever it opens.
param(
  [string]$Node = "",
  [string]$Launch = "",
  [string]$HotkeyLog = ""        # for checks only: write a line here when the shortcut is pressed, and do nothing else
)
# Only one icon, however often this is started.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, "Local\FalconTrayIcon", [ref]$created)
if (-not $created) { exit 0 }

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace FalconTray -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr hWnd, int nCmdShow);
'@
# The shortcut that calls Falcon from anywhere: Ctrl+Alt+Space. Windows delivers it to a small unseen window.
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public class FalconHotkey : NativeWindow, IDisposable {
  [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr hWnd, int id, uint modifiers, uint vk);
  [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr hWnd, int id);
  public event EventHandler Pressed;
  public bool Registered;
  // modifiers: Alt 1, Ctrl 2, Shift 4; 0x4000 stops it repeating while held
  public FalconHotkey(uint modifiers, uint key) {
    CreateHandle(new CreateParams());
    Registered = RegisterHotKey(Handle, 1, modifiers | 0x4000, key);
  }
  protected override void WndProc(ref Message m) {
    if (m.Msg == 0x0312 && Pressed != null) Pressed(this, EventArgs.Empty);
    base.WndProc(ref m);
  }
  public void Dispose() { if (Registered) UnregisterHotKey(Handle, 1); DestroyHandle(); }
}
'@

$app = if ($Launch) { Split-Path (Split-Path (Split-Path $Launch -Parent) -Parent) -Parent } else { Split-Path $PSScriptRoot -Parent }
if (-not $Launch) { $Launch = Join-Path $app "src\app\launch.js" }
if (-not $Node) {
  $Node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
  if (-not $Node) { $Node = Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe" }
}

function Get-FalconWindow {
  $ids = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*\.falcon\window*" } | ForEach-Object { $_.ProcessId })
  if (-not $ids) { return $null }
  return Get-Process -Id $ids -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
}

function Open-Falcon {
  $existing = Get-FalconWindow
  if ($existing) {
    [FalconTray.Win]::ShowWindowAsync($existing.MainWindowHandle, 9) | Out-Null   # restore if minimised
    [FalconTray.Win]::SetForegroundWindow($existing.MainWindowHandle) | Out-Null
    return
  }
  Start-Process (Join-Path $env:SystemRoot "System32\conhost.exe") -ArgumentList "--headless `"$Node`" `"$Launch`"" -WorkingDirectory $app
}

# Called by the shortcut. Brings Falcon forward (starting him if need be) and, when his window is already
# up, asks it to start listening. The window's address and its private token are in a file only this user
# can read, written by Falcon when he starts.
function Summon-Falcon {
  $wasOpen = [bool](Get-FalconWindow)
  Open-Falcon
  if (-not $wasOpen) { return }
  try {
    $info = Get-Content (Join-Path $env:USERPROFILE ".falcon\window.json") -Raw -ErrorAction Stop | ConvertFrom-Json
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$($info.port)/api/summon" -Headers @{ "X-Falcon-Token" = $info.token } `
      -ContentType "application/json" -Body "{}" -TimeoutSec 3 | Out-Null
  } catch { }   # the window is in front either way
}

function Quit-Falcon {
  # Closes Falcon's window and his window server. The engine keeps running, so Telegram and the
  # morning briefing still work; the icon comes back the next time Falcon is opened or at sign-in.
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessId -ne $PID -and $_.CommandLine -and ($_.CommandLine -like "*$Launch*" -or $_.CommandLine -like "*\.falcon\window*")
  } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $script:icon.Visible = $false
  [System.Windows.Forms.Application]::Exit()
}

# The icon: Falcon's orb, drawn small and sharp for the notification area.
$picture = @((Join-Path $app "ui\falcon.png"), (Join-Path $app "falcon.png")) | Where-Object { Test-Path $_ } | Select-Object -First 1
$icon = New-Object System.Windows.Forms.NotifyIcon
try {
  $source = [System.Drawing.Image]::FromFile($picture)
  $small = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($small)
  $g.InterpolationMode = "HighQualityBicubic"
  $g.DrawImage($source, 0, 0, 32, 32)
  $g.Dispose()
  $icon.Icon = [System.Drawing.Icon]::FromHandle($small.GetHicon())
} catch {
  $icon.Icon = [System.Drawing.SystemIcons]::Application
}
$icon.Text = "Falcon"

# Another program may already hold a shortcut (seen: Ctrl+Alt+Space was taken on the first PC tried), so
# take the first of these that is free, and tell the window which one it is.
$hotkey = $null
$shortcutName = ""
$shortcutFile = Join-Path $env:USERPROFILE ".falcon\shortcut.txt"
try {
  foreach ($choice in @(@(3, 0x20, "Ctrl+Alt+Space"), @(3, 0x46, "Ctrl+Alt+F"), @(6, 0x20, "Ctrl+Shift+Space"), @(5, 0x46, "Alt+Shift+F"))) {
    $try = New-Object FalconHotkey ([uint32]$choice[0]), ([uint32]$choice[1])
    if ($try.Registered) { $hotkey = $try; $shortcutName = $choice[2]; break }
    $try.Dispose()
  }
  if (-not $HotkeyLog) {
    New-Item -ItemType Directory -Force (Split-Path $shortcutFile) | Out-Null
    Set-Content -Path $shortcutFile -Value $shortcutName -Encoding ascii
  }
  if ($hotkey) {
    $icon.Text = "Falcon ($shortcutName)"
    $hotkey.add_Pressed({
      if ($HotkeyLog) { Add-Content -Path $HotkeyLog -Value "pressed" -Encoding ascii }
      else { Summon-Falcon }
    })
  }
} catch { }   # another program holds the shortcut: Falcon works without it
if ($HotkeyLog) { Add-Content -Path $HotkeyLog -Value ("registered=" + $shortcutName) -Encoding ascii }

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = $menu.Items.Add("Open Falcon")
$open.Font = New-Object System.Drawing.Font($open.Font, [System.Drawing.FontStyle]::Bold)
$open.add_Click({ Open-Falcon })
[void]$menu.Items.Add("-")
$quit = $menu.Items.Add("Quit Falcon")
$quit.add_Click({ Quit-Falcon })
$icon.ContextMenuStrip = $menu
$icon.add_MouseClick({ param($s, $e) if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Open-Falcon } })
$icon.Visible = $true

$context = New-Object System.Windows.Forms.ApplicationContext
[System.Windows.Forms.Application]::Run($context)
if ($hotkey) { $hotkey.Dispose() }
$icon.Dispose()
$mutex.ReleaseMutex()
