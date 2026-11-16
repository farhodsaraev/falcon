# Installs or refreshes Falcon in the agent workspace (Windows wrapper around install-falcon.mjs).
#   powershell -ExecutionPolicy Bypass -File install-falcon.ps1 [-SkipSettings]
param([switch]$SkipSettings)
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe" }
if (-not (Test-Path $node)) { Write-Error "Node.js was not found."; exit 1 }
$extra = @(); if ($SkipSettings) { $extra += "--skip-settings" }
& $node (Join-Path $PSScriptRoot "install-falcon.mjs") @extra
exit $LASTEXITCODE
