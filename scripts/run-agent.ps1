<#
  Start the local Python agent (Windows)
  - Avoids PS activation; uses venv python directly
  - Bootstraps pip if missing
  - Installs requirements
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host "[agent] Preparing venv..."
Set-Location -Path "apps/agent"

if (-not (Test-Path .venv)) {
  Write-Host "[agent] Creating .venv"
  python -m venv .venv
}

$venvPython = Join-Path (Join-Path (Get-Location) ".venv") "Scripts\\python.exe"
if (-not (Test-Path $venvPython)) {
  throw "[agent] venv python not found at $venvPython"
}

Write-Host "[agent] Ensuring pip..."
& $venvPython -m ensurepip --upgrade | Out-Host
& $venvPython -m pip install --upgrade pip wheel setuptools | Out-Host

Write-Host "[agent] Ensuring dependencies..."
& $venvPython -m pip install -r requirements.txt | Out-Host

$env:CLOUD_AI_WS = if ($env:CLOUD_AI_WS) { $env:CLOUD_AI_WS } else { "ws://127.0.0.1:8082/ws" }
Write-Host "[agent] Starting agent with CLOUD_AI_WS=$($env:CLOUD_AI_WS)"
& $venvPython -m app.main
