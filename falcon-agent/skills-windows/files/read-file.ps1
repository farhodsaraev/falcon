# Reads what is written inside a PDF, Word or text file and prints one line of JSON. Read-only.
#   powershell -NoProfile -ExecutionPolicy Bypass -File read-file.ps1 -Path "C:\...\file.pdf" [-Pages 30] [-Max 20000]
# The reading itself is done by read-file.mjs next to this file; this only finds Node.js and passes the request on.
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [int]$Pages = 30,
  [int]$Max = 20000
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Fail([string]$message) {
  Write-Output (@{ ok = $false; error = $message } | ConvertTo-Json -Compress)
  exit 1
}

$env:Path = $env:Path + ";" + [Environment]::GetEnvironmentVariable("Path", "User") + ";" + [Environment]::GetEnvironmentVariable("Path", "Machine")
$node = $null
$onPath = Get-Command node.exe -ErrorAction SilentlyContinue
if ($onPath) { $node = $onPath.Source }
if (-not $node) {
  $usual = Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe"
  if (Test-Path $usual) { $node = $usual }
}
if (-not $node) { Fail "Node.js was not found, so the file could not be read." }

& $node (Join-Path $PSScriptRoot "read-file.mjs") --path $Path --pages $Pages --max $Max
exit $LASTEXITCODE
