# Opens a presentation (by path, by words in its name, or the one already open),
# starts the slide show and jumps to a slide. Prints one line of JSON.
param(
  [string]$Path = "",
  [string]$Find = "",          # words from the file name; newest match wins
  [int]$Slide = 0
)
$ErrorActionPreference = "Stop"
function Esc([string]$s) { $s.Replace("'", "''").Replace("%", "").Replace("[", "").Replace("]", "") }
try {
  if (-not $Path -and $Find) {
    $where = @("(System.FileExtension = '.pptx' OR System.FileExtension = '.ppt')")
    foreach ($word in ($Find -split '\s+' | Where-Object { $_ })) { $where += "System.FileName LIKE '%$(Esc $word)%'" }
    $where += "SCOPE='file:$(Esc ($env:USERPROFILE -replace '\\','/'))'"
    $c = New-Object -ComObject ADODB.Connection
    $c.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")
    $rs = $c.Execute("SELECT TOP 1 System.ItemPathDisplay FROM SYSTEMINDEX WHERE " + ($where -join " AND ") + " ORDER BY System.DateModified DESC")
    if (-not $rs.EOF) { $Path = [string]$rs.Fields.Item(0).Value }
    $c.Close()
    if (-not $Path) { throw "No presentation with '$Find' in its name was found." }
  }

  $ppt = New-Object -ComObject PowerPoint.Application
  $ppt.Visible = -1

  $pres = $null
  if ($Path) {
    $full = (Resolve-Path -LiteralPath $Path).Path
    foreach ($p in $ppt.Presentations) { if ($p.FullName -eq $full) { $pres = $p } }
    if (-not $pres) {
      try { $pres = $ppt.Presentations.Open($full) }
      catch { $pres = $ppt.Presentations.Open($full, -1) }   # in use elsewhere: open a read-only copy
    }
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
  @{ ok = $true; name = $pres.Name; path = $pres.FullName; slide = $current; total = $total } | ConvertTo-Json -Compress
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
