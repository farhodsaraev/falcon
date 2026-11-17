# Makes a Word document, Excel spreadsheet or PowerPoint deck from the spec Falcon wrote, and prints one line of JSON.
#   powershell -NoProfile -ExecutionPolicy Bypass -File make-document.ps1 [-Spec "C:\...\spec.json"] [-Open]
# The work is done by make-document.mjs next to this file; this only finds Node.js and passes the request on.
param(
  [string]$Spec = "",
  [switch]$Open
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Fail([string]$message) {
  Write-Output (@{ ok = $false; error = $message } | ConvertTo-Json -Compress)
  exit 1
}

if (-not $Spec) { $Spec = Join-Path $PSScriptRoot "spec.json" }

$env:Path = $env:Path + ";" + [Environment]::GetEnvironmentVariable("Path", "User") + ";" + [Environment]::GetEnvironmentVariable("Path", "Machine")
$node = $null
$onPath = Get-Command node.exe -ErrorAction SilentlyContinue
if ($onPath) { $node = $onPath.Source }
if (-not $node) {
  $usual = Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe"
  if (Test-Path $usual) { $node = $usual }
}
if (-not $node) { Fail "Node.js was not found, so the document could not be made." }

$arguments = @((Join-Path $PSScriptRoot "make-document.mjs"), "--spec", $Spec)
if ($Open) { $arguments += "--open" }
& $node @arguments
exit $LASTEXITCODE
