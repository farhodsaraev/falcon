# Builds the customer package into dist\:
#   dist\falcon\      the unzipped package (install.ps1 + files)
#   dist\falcon.zip   the same, zipped for hosting or sending
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$dist = Join-Path $root "dist"
$out = Join-Path $dist "falcon"
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Force $out | Out-Null

# Files Falcon needs at run time (the window uses only what comes with Node.js)
New-Item -ItemType Directory -Force (Join-Path $out "src") | Out-Null
Copy-Item (Join-Path $root "src\app") (Join-Path $out "src\app") -Recurse
Copy-Item (Join-Path $root "ui") $out -Recurse
Copy-Item (Join-Path $root "falcon-agent") $out -Recurse
Copy-Item (Join-Path $root "installer\install.ps1") $out
Copy-Item (Join-Path $root "NOTICE") $out   # OpenClaw's licence travels with every copy
New-Item -ItemType Directory -Force (Join-Path $out "demo") | Out-Null
Get-ChildItem (Join-Path $root "demo") -File | Where-Object { $_.Name -notlike '~$*' } | Copy-Item -Destination (Join-Path $out "demo")
'{ "name": "falcon", "version": "0.1.0", "private": true, "type": "module" }' | Set-Content (Join-Path $out "package.json") -Encoding ascii

# Icon: a glowing blue orb, drawn here so no image file has to be kept in the repo
Add-Type -AssemblyName System.Drawing
$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = "AntiAlias"
$g.Clear([System.Drawing.Color]::Transparent)
function Orb($g, [float]$inset, $centerColor, $edgeColor, [float]$fx, [float]$fy) {
  $rect = New-Object System.Drawing.RectangleF $inset, $inset, (256 - 2 * $inset), (256 - 2 * $inset)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddEllipse($rect)
  $brush = New-Object System.Drawing.Drawing2D.PathGradientBrush $path
  $brush.CenterPoint = New-Object System.Drawing.PointF $fx, $fy
  $brush.CenterColor = $centerColor
  $brush.SurroundColors = @($edgeColor)
  $g.FillPath($brush, $path)
  $brush.Dispose(); $path.Dispose()
}
Orb $g 4  ([System.Drawing.Color]::FromArgb(150, 79, 216, 255)) ([System.Drawing.Color]::FromArgb(0, 20, 121, 201)) 128 128     # glow
Orb $g 40 ([System.Drawing.Color]::FromArgb(255, 79, 216, 255)) ([System.Drawing.Color]::FromArgb(255, 9, 60, 110)) 108 100      # body
Orb $g 78 ([System.Drawing.Color]::FromArgb(230, 235, 252, 255)) ([System.Drawing.Color]::FromArgb(0, 79, 216, 255)) 104 96      # highlight
$g.Dispose()
$png = New-Object System.IO.MemoryStream
$bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$bytes = $png.ToArray()
$ico = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $ico
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]1)                 # header: icon, one image
$w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0)    # 256x256, no palette
$w.Write([uint16]1); $w.Write([uint16]32)                                     # planes, bits per pixel
$w.Write([uint32]$bytes.Length); $w.Write([uint32]22)                         # size, offset
$w.Write($bytes); $w.Flush()
[IO.File]::WriteAllBytes((Join-Path $out "falcon.ico"), $ico.ToArray())

Compress-Archive -Path (Join-Path $out "*") -DestinationPath (Join-Path $dist "falcon.zip")
Copy-Item (Join-Path $root "installer\install.ps1") $dist
"Package: " + (Join-Path $dist "falcon.zip") + "  (" + [int]((Get-Item (Join-Path $dist "falcon.zip")).Length / 1kb) + " KB)"
