# Opens a presentation (or uses the one already open), starts the slide show
# and jumps to a slide. Prints one line of JSON.
param(
  [string]$Path = "",
  [int]$Slide = 0
)
$ErrorActionPreference = "Stop"
try {
  $ppt = New-Object -ComObject PowerPoint.Application
  $ppt.Visible = -1

  $pres = $null
  if ($Path) {
    $full = (Resolve-Path -LiteralPath $Path).Path
    foreach ($p in $ppt.Presentations) { if ($p.FullName -eq $full) { $pres = $p } }
    if (-not $pres) { $pres = $ppt.Presentations.Open($full) }
  } elseif ($ppt.Presentations.Count -gt 0) {
    $pres = $ppt.ActivePresentation
  } else {
    throw "No presentation is open."
  }

  $total = $pres.Slides.Count
  $current = 1
  if ($Slide -gt 0) {
    if ($Slide -gt $total) { throw "The presentation has only $total slides." }
    $win = $null
    try { $win = $pres.SlideShowWindow } catch { }
    if (-not $win) {
      $win = $pres.SlideShowSettings.Run()
      Start-Sleep -Milliseconds 600
    }
    $win.View.GotoSlide($Slide)
    $current = $win.View.Slide.SlideIndex
  }
  @{ ok = $true; name = $pres.Name; slide = $current; total = $total } | ConvertTo-Json -Compress
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
