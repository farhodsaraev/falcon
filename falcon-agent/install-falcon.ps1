# Turns a fresh OpenClaw agent workspace into Falcon (Windows).
# Safe to run again: it replaces only the Falcon parts.
param(
  [string]$Workspace = (Join-Path $env:USERPROFILE ".openclaw\workspace"),
  [switch]$SkipSettings      # copy the files only, leave OpenClaw's settings alone
)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot

if (-not (Test-Path $Workspace)) { throw "OpenClaw workspace not found at $Workspace. Install and set up OpenClaw first." }

# Personality and identity
Copy-Item (Join-Path $here "SOUL.md") (Join-Path $Workspace "SOUL.md") -Force
Copy-Item (Join-Path $here "IDENTITY.md") (Join-Path $Workspace "IDENTITY.md") -Force

# Working rules: keep OpenClaw's own AGENTS.md, add (or refresh) the Falcon section at the end
$agentsPath = Join-Path $Workspace "AGENTS.md"
$utf8 = New-Object System.Text.UTF8Encoding($false)
$agents = if (Test-Path $agentsPath) { [IO.File]::ReadAllText($agentsPath) } else { "# AGENTS.md`n" }
$agents = [regex]::Replace($agents, "(?s)\r?\n*<!-- (jarvis|falcon):start -->.*?<!-- (jarvis|falcon):end -->\r?\n*", "`n")
$section = [IO.File]::ReadAllText((Join-Path $here "AGENTS.falcon.md"))
# OpenClaw's approval system needs real, literal file paths in commands (no variables)
$section = $section.Replace('$env:USERPROFILE\.openclaw\workspace', $Workspace)
[IO.File]::WriteAllText($agentsPath, $agents.TrimEnd() + "`n`n" + $section.Trim() + "`n", $utf8)

# Falcon already knows who he is, so skip OpenClaw's first-run "who am I?" interview
$bootstrap = Join-Path $Workspace "BOOTSTRAP.md"
if (Test-Path $bootstrap) { Remove-Item $bootstrap -Confirm:$false }

# Skills
$skills = Join-Path $Workspace "skills"
New-Item -ItemType Directory -Force $skills | Out-Null
Copy-Item (Join-Path $here "skills\*") $skills -Recurse -Force
Get-ChildItem $skills -Recurse -Filter SKILL.md | ForEach-Object {
  $text = [IO.File]::ReadAllText($_.FullName).Replace('<folder of this SKILL.md>', $_.DirectoryName)
  [IO.File]::WriteAllText($_.FullName, $text, $utf8)
}

Write-Host "Falcon is installed in $Workspace"

# ---- Settings (needs the OpenClaw Gateway running) ----
if ($SkipSettings) { return }
if (-not (Get-Command openclaw -ErrorAction SilentlyContinue)) {
  Write-Warning "The 'openclaw' command was not found, so settings were not applied. Open a new terminal and run this script again."
  return
}
$ErrorActionPreference = "Continue"
function Step([string]$what, [scriptblock]$do) {
  $out = & $do 2>&1 | Out-String
  if ($LASTEXITCODE -eq 0) { Write-Host "  ok    $what" } else { Write-Warning "$what failed: $($out.Trim().Split("`n")[0])" }
}
Write-Host "Applying settings..."
# Quick answers: no long thinking before simple actions
Step "fast replies" { openclaw config set agents.defaults.thinkingDefault off }
# Falcon speaks only when spoken to: no background check-ins
Step "no background check-ins" { openclaw config set agents.defaults.heartbeat.every 0m }
# Ask before any command that is not on the allow list; refuse if nobody answers
Step "ask-first approvals" { '{ "version": 1, "defaults": { "security": "allowlist", "ask": "on-miss", "askFallback": "deny" } }' | openclaw approvals set --gateway --stdin }
# Falcon's own read-only helper scripts never need a prompt
Get-ChildItem $skills -Recurse -Filter *.ps1 | ForEach-Object {
  $script = $_.FullName
  Step "pre-approve $($_.Name)" { openclaw approvals allowlist add $script --gateway }
}
Write-Host "Done. Say hello to Falcon in the OpenClaw chat."
