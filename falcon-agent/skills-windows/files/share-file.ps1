# Gets a file ready to be sent on Telegram or another chat, and prints one line of JSON with the path to send.
#   powershell -NoProfile -ExecutionPolicy Bypass -File share-file.ps1 -Path "C:\...\file.pdf"
# The work is done by share-file.mjs next to this file; this only finds Node.js and passes the request on.
param(
  [Parameter(Mandatory = $true)][string]$Path
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
if (-not $node) { Fail "Node.js was not found, so the file could not be prepared." }

& $node (Join-Path $PSScriptRoot "share-file.mjs") --path $Path
exit $LASTEXITCODE
