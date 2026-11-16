# Captures the main screen to a JPEG next to this script and prints one line of JSON.
$ErrorActionPreference = "Stop"
try {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  Add-Type -Namespace FalconNs -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
  [FalconNs.Dpi]::SetProcessDPIAware() | Out-Null
  $out = Join-Path $PSScriptRoot "screen.jpg"
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  # Scale down to at most 1600 px wide: enough to read, quicker to look at
  $scale = [Math]::Min(1.0, 1600 / $b.Width)
  $w = [int]($b.Width * $scale); $h = [int]($b.Height * $scale)
  $small = New-Object System.Drawing.Bitmap $bmp, $w, $h
  $small.Save($out, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  $g.Dispose(); $bmp.Dispose(); $small.Dispose()
  @{ ok = $true; path = $out; width = $w; height = $h } | ConvertTo-Json -Compress
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
