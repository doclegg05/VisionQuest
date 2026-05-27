<#
.SYNOPSIS
  Pre-warms the local Ollama model so the first Sage chat of the day is fast.

.DESCRIPTION
  Loading gemma4:latest (8B Q4) into VRAM cold takes 20-45 seconds. When the
  model is idle overnight Ollama unloads it, so the first morning Sage prompt
  times out before the model finishes loading. This script POSTs a one-token
  generation request to local Ollama with keep_alive=8h, forcing the model
  resident in VRAM for the workday.

  Bypasses the Cloudflare tunnel and goes straight to 127.0.0.1:11434 so
  the warmup does not depend on cloudflared or the relay being up yet.

.NOTES
  Registered as scheduled task "Sage Model Warmup" — triggers at logon
  (60s delay) and daily at 07:30. See README for re-registration.
#>

[CmdletBinding()]
param(
  [string] $OllamaUrl = "http://127.0.0.1:11434",
  [string] $Model     = "gemma4:latest",
  [string] $KeepAlive = "8h",
  [int]    $TimeoutSec = 180,
  [string] $LogPath   = "$env:LOCALAPPDATA\VisionQuest\sage-warmup.log"
)

$ErrorActionPreference = "Continue"

$logDir = Split-Path -Parent $LogPath
if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Write-Log([string]$message) {
  $stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  "$stamp $message" | Add-Content -Path $LogPath -Encoding utf8
}

Write-Log "warmup start model=$Model url=$OllamaUrl keep_alive=$KeepAlive"

$body = @{
  model      = $Model
  prompt     = "ok"
  stream     = $false
  keep_alive = $KeepAlive
  options    = @{ num_predict = 1 }
} | ConvertTo-Json -Compress

try {
  $start = Get-Date
  $response = Invoke-WebRequest -Uri "$OllamaUrl/api/generate" `
    -Method POST `
    -ContentType "application/json" `
    -Body $body `
    -UseBasicParsing `
    -TimeoutSec $TimeoutSec
  $elapsed = [int]((Get-Date) - $start).TotalSeconds
  Write-Log "warmup ok status=$($response.StatusCode) elapsed=${elapsed}s"
  exit 0
}
catch {
  Write-Log "warmup failed error=$($_.Exception.Message)"
  exit 1
}
