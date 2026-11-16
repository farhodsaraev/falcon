# Captures the main screen to a PNG file. Prints one line of JSON.
param([Parameter(Mandatory)][string]$Out)
$ErrorActionPreference = "Stop"
try {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  Add-Type -Namespace Jarvis -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
  [Jarvis.Dpi]::SetProcessDPIAware() | Out-Null
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  @{ ok = $true; path = $Out; width = $b.Width; height = $b.Height } | ConvertTo-Json -Compress
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
