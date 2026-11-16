# Falcon's scout on Windows. The work is done by scout-sources.mjs and scout-report.mjs next to this
# file; this only finds Node.js and passes the request on.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scout.ps1 -Do sweep -Name "Uzum" -Type company [-Hint "..."] [-Aliases "a, b"] [-Site uzum.uz] [-Handles "uzum.market, uzum_uz"]
#   powershell -NoProfile -ExecutionPolicy Bypass -File scout.ps1 -Do report
param(
  [ValidateSet("sweep", "report")][string]$Do = "sweep",
  [string]$Name = "",
  [ValidateSet("person", "company")][string]$Type = "person",
  [string]$Hint = "",
  [string]$Aliases = "",
  [string]$Site = "",
  [string]$Handles = ""
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
if (-not $node) { Fail "Node.js was not found, so the scout could not run." }

if ($Do -eq "report") {
  & $node (Join-Path $PSScriptRoot "scout-report.mjs") --data (Join-Path $PSScriptRoot "dossier.json")
} else {
  if (-not $Name) { Fail "Give the name to scout with -Name." }
  # Windows PowerShell drops empty arguments, so pass only the options that have a value.
  $rest = @("--name", $Name, "--type", $Type)
  if ($Hint) { $rest += @("--hint", $Hint) }
  if ($Aliases) { $rest += @("--aliases", $Aliases) }
  if ($Site) { $rest += @("--site", $Site) }
  if ($Handles) { $rest += @("--handles", $Handles) }
  & $node (Join-Path $PSScriptRoot "scout-sources.mjs") @rest
}
exit $LASTEXITCODE
