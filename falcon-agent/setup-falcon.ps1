# Falcon setup for Windows. Run from PowerShell:
#   powershell -ExecutionPolicy Bypass -File setup-falcon.ps1
# It installs the engine Falcon runs on (if missing), connects your AI key,
# installs Falcon and opens his chat window. Safe to run again.
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$log = Join-Path $env:TEMP "falcon-setup.log"
function Say([string]$text) { Write-Host "Falcon setup: $text" }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "User") + ";" + [Environment]::GetEnvironmentVariable("Path", "Machine")
  $bin = Join-Path $env:USERPROFILE ".openclaw\bin"
  if (Test-Path $bin) { $env:Path = "$bin;$env:Path" }
}

# 1. Engine
Refresh-Path
if (-not (Get-Command openclaw -ErrorAction SilentlyContinue)) {
  Say "installing the engine (a few minutes)..."
  & ([scriptblock]::Create((Invoke-WebRequest -UseBasicParsing https://openclaw.ai/install.ps1))) -NoOnboard *>> $log
  Refresh-Path
  if (-not (Get-Command openclaw -ErrorAction SilentlyContinue)) {
    throw "The engine did not install. Details are in $log. Close this window, open a new PowerShell and run the setup again."
  }
}

# 2. First-time configuration and AI key
if (-not (Test-Path (Join-Path $env:USERPROFILE ".openclaw\openclaw.json"))) {
  Write-Host ""
  Write-Host "Falcon can open apps, read files, use the browser and run commands on this"
  Write-Host "computer. He asks before sending, deleting or running anything unfamiliar,"
  Write-Host "but an assistant with this much access is powerful and carries risk."
  if ((Read-Host "Type YES to accept and continue") -ne "YES") { Say "stopped. Nothing was configured."; return }

  $secure = Read-Host "Paste your OpenAI key (it stays on this computer)" -AsSecureString
  $key = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  if (-not $key) { throw "No key entered." }
  Say "configuring..."
  openclaw onboard --non-interactive --accept-risk --mode local --auth-choice openai-api-key --openai-api-key $key `
    --gateway-bind loopback --gateway-auth token --install-daemon --agent-name Falcon *>> $log
  $key = $null
  if ($LASTEXITCODE -ne 0) { throw "Configuration failed. Details are in $log." }
}

# 3. Start the engine and wait until it answers
Say "starting..."
openclaw gateway start *>> $log
$ready = $false
foreach ($i in 1..30) {
  openclaw gateway status *> $null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ready) { throw "The engine did not start. Details are in $log." }

# 4. Falcon himself: personality, skills, safety settings
& (Join-Path $here "install-falcon.ps1")

# 5. Open the chat
Say "ready. Opening the chat window..."
openclaw dashboard *>> $log
