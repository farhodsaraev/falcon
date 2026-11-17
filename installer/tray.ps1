# Falcon's icon among the hidden icons, next to the clock (Windows).
# Click it to open Falcon; right-click for Open and Quit. Closing Falcon's window leaves the icon here.
# Started at sign-in by the installer's Startup entry, and by Falcon's window whenever it opens.
param(
  [string]$Node = "",
  [string]$Launch = ""
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
$icon.Dispose()
$mutex.ReleaseMutex()
