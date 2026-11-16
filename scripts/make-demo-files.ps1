# Creates the practice files for the demo in the "demo" folder:
# an 8-slide presentation and last month's invoice as a PDF.
$ErrorActionPreference = "Stop"
$demo = Join-Path (Split-Path $PSScriptRoot -Parent) "demo"
New-Item -ItemType Directory -Force $demo | Out-Null

$deck = Join-Path $demo "Quarterly Review.pptx"
if (-not (Test-Path $deck)) {
  $wasRunning = [bool](Get-Process POWERPNT -ErrorAction SilentlyContinue)
  $ppt = New-Object -ComObject PowerPoint.Application
  $pres = $ppt.Presentations.Add(0)
  $titles = "Quarterly Review", "Agenda", "Highlights", "Revenue", "Regional Results", "Customers", "Plan for Next Quarter", "Questions"
  for ($i = 0; $i -lt $titles.Count; $i++) {
    $s = $pres.Slides.Add($i + 1, 2)
    $s.Shapes.Item(1).TextFrame.TextRange.Text = $titles[$i]
    $s.Shapes.Item(2).TextFrame.TextRange.Text = "Slide $($i + 1) of $($titles.Count)"
  }
  $pres.SaveAs($deck); $pres.Close()
  if (-not $wasRunning) { $ppt.Quit() }
}

# The invoice PDF is written by hand (no Word needed).
$lastMonth = (Get-Date).AddMonths(-1)
$period = $lastMonth.ToString("MMMM yyyy", [Globalization.CultureInfo]::InvariantCulture)
$invoice = Join-Path $demo "Invoice $period.pdf"
if (-not (Test-Path $invoice)) {
  $lines = "INVOICE (demo)", "", "Period: $period", "Consulting services: 4,800.00 USD", "Total due: 4,800.00 USD"
  $text = "BT /F1 16 Tf 72 740 Td 22 TL " + (($lines | ForEach-Object { "($_) Tj T*" }) -join " ") + " ET"
  $objs = @(
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length $($text.Length) >>`nstream`n$text`nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  )
  $pdf = "%PDF-1.4`n"; $offsets = @()
  for ($i = 0; $i -lt $objs.Count; $i++) { $offsets += $pdf.Length; $pdf += "$($i + 1) 0 obj`n$($objs[$i])`nendobj`n" }
  $xref = $pdf.Length
  $pdf += "xref`n0 $($objs.Count + 1)`n0000000000 65535 f `n"
  foreach ($o in $offsets) { $pdf += ("{0:D10} 00000 n `n" -f $o) }
  $pdf += "trailer`n<< /Size $($objs.Count + 1) /Root 1 0 R >>`nstartxref`n$xref`n%%EOF`n"
  [IO.File]::WriteAllBytes($invoice, [Text.Encoding]::ASCII.GetBytes($pdf))
}
Get-ChildItem $demo | Select-Object -ExpandProperty FullName
