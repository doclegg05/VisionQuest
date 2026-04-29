<#
.SYNOPSIS
  Installs the local-AI tunnel chain (cloudflared + ollama-relay) as
  Windows services so production Sage stays connected across reboots.

.DESCRIPTION
  Production VisionQuest on Render reaches the local Ollama via
  Cloudflare Tunnel: Render -> Cloudflare DNS (llm.leggaiops.com) ->
  cloudflared (this machine) -> ollama-relay :11435 -> Ollama :11434.

  The relay (scripts/ollama-relay.mjs) sits between cloudflared and
  Ollama to defeat Cloudflare's 120s proxy read timeout by emitting
  heartbeats while Ollama evaluates the prompt.

  Both pieces were running as foreground processes; whenever the
  machine rebooted or the windows closed, Sage would silently break
  for staff and students. This script installs them as Windows
  services so they restart automatically.

  After running successfully:
    - cloudflared       : auto-start service, runs the tunnel
    - VisionQuest-OllamaRelay : auto-start NSSM service, runs the
                                relay with restart-on-crash

.NOTES
  Must be run from an elevated PowerShell.

  Re-running is safe — each step checks for existing service state
  before changing it.
#>

[CmdletBinding()]
param(
  [string] $RelayScript = "C:\Users\Instructor\Dev\VisionQuest\scripts\ollama-relay.mjs",
  [string] $RelayServiceName = "VisionQuest-OllamaRelay",
  [string] $CloudflaredExe = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
)

$ErrorActionPreference = "Stop"

function Assert-Elevated {
  $current = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($current)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "This script must be run from an elevated PowerShell. Right-click PowerShell -> Run as Administrator."
  }
}

function Step($n, $label) {
  Write-Host ""
  Write-Host "=== Step $n : $label ===" -ForegroundColor Cyan
}

Assert-Elevated

# ----------------------------------------------------------------------
Step 1 "Verify prerequisites"

if (-not (Test-Path $CloudflaredExe)) {
  throw "cloudflared not found at $CloudflaredExe. Install it from https://github.com/cloudflare/cloudflared/releases first."
}
if (-not (Test-Path $RelayScript)) {
  throw "Relay script not found at $RelayScript."
}
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  throw "Node.js not found on PATH."
}
Write-Host "  cloudflared : $CloudflaredExe"
Write-Host "  relay       : $RelayScript"
Write-Host "  node        : $node"

# ----------------------------------------------------------------------
Step 2 "Install NSSM (used to wrap the Node relay as a service)"

$nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
if ($nssm) {
  Write-Host "  NSSM already installed at $nssm — skipping."
} else {
  Write-Host "  Installing NSSM via winget..."
  & winget install --id NSSM.NSSM --silent --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    throw "winget install of NSSM failed (exit $LASTEXITCODE). Install manually from https://nssm.cc/download and re-run."
  }
  # winget puts NSSM under user-scope; rediscover.
  $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
  $nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
  if (-not $nssm) {
    throw "NSSM installed but not found on PATH. Open a new PowerShell window and re-run."
  }
  Write-Host "  NSSM installed at $nssm"
}

# ----------------------------------------------------------------------
Step 3 "Install cloudflared as a Windows service"

$cfSvc = Get-Service -Name "cloudflared" -ErrorAction SilentlyContinue
if ($cfSvc) {
  Write-Host "  cloudflared service already present (status: $($cfSvc.Status)) — skipping install."
} else {
  & $CloudflaredExe service install
  if ($LASTEXITCODE -ne 0) {
    throw "cloudflared service install failed (exit $LASTEXITCODE)."
  }
  $cfSvc = Get-Service -Name "cloudflared" -ErrorAction SilentlyContinue
  if (-not $cfSvc) { throw "cloudflared service was not registered after install." }
  Write-Host "  cloudflared service installed."
}

Set-Service -Name "cloudflared" -StartupType Automatic
if ($cfSvc.Status -ne "Running") {
  Start-Service -Name "cloudflared"
  Write-Host "  cloudflared service started."
} else {
  Write-Host "  cloudflared service already running."
}

# ----------------------------------------------------------------------
Step 4 "Install the Ollama relay as a Windows service via NSSM"

$relaySvc = Get-Service -Name $RelayServiceName -ErrorAction SilentlyContinue
if ($relaySvc) {
  Write-Host "  $RelayServiceName already present (status: $($relaySvc.Status)) — reconfiguring..."
  & $nssm stop $RelayServiceName confirm | Out-Null
  & $nssm remove $RelayServiceName confirm
  if ($LASTEXITCODE -ne 0) { throw "Failed to remove existing $RelayServiceName service." }
}

& $nssm install $RelayServiceName $node $RelayScript
if ($LASTEXITCODE -ne 0) { throw "nssm install failed (exit $LASTEXITCODE)." }

# Working dir + log files.
$logDir = "C:\ProgramData\VisionQuest\logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
& $nssm set $RelayServiceName AppDirectory  (Split-Path $RelayScript)   | Out-Null
& $nssm set $RelayServiceName AppStdout     "$logDir\ollama-relay.out.log" | Out-Null
& $nssm set $RelayServiceName AppStderr     "$logDir\ollama-relay.err.log" | Out-Null
& $nssm set $RelayServiceName AppRotateFiles 1                          | Out-Null
& $nssm set $RelayServiceName AppRotateBytes 10485760                   | Out-Null  # 10 MB

# Restart on crash, with a 5-second backoff and unlimited retries.
& $nssm set $RelayServiceName AppExit Default Restart                   | Out-Null
& $nssm set $RelayServiceName AppRestartDelay 5000                      | Out-Null

# Auto-start on boot.
& $nssm set $RelayServiceName Start SERVICE_AUTO_START                  | Out-Null

# Make sure the relay starts AFTER cloudflared is registered (loose
# dependency — the relay can start before cloudflared connects, since
# cloudflared keeps trying. But ordering at boot is cleaner.)
& $nssm set $RelayServiceName DependOnService cloudflared               | Out-Null

Start-Service -Name $RelayServiceName
Write-Host "  $RelayServiceName service installed and started."
Write-Host "  Logs: $logDir\ollama-relay.{out,err}.log"

# ----------------------------------------------------------------------
Step 5 "Smoke-test the chain"

Start-Sleep -Seconds 3

# 1. Ollama itself
try {
  $r = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -TimeoutSec 5 -UseBasicParsing
  Write-Host "  Ollama :11434 OK ($($r.StatusCode))"
} catch { throw "Ollama :11434 not responding: $($_.Exception.Message)" }

# 2. Relay
try {
  $r = Invoke-WebRequest -Uri "http://localhost:11435/api/tags" -TimeoutSec 5 -UseBasicParsing
  Write-Host "  Relay  :11435 OK ($($r.StatusCode))"
} catch { throw "Relay :11435 not responding: $($_.Exception.Message)" }

# 3. Cloudflared service status (the tunnel may take 10-20s to register
# with Cloudflare's edge — we don't wait for that here).
$cf = Get-Service -Name "cloudflared"
Write-Host "  cloudflared service: $($cf.Status)"

# ----------------------------------------------------------------------
Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "Next: in a browser logged in as admin on visionquest.onrender.com, run"
Write-Host "  fetch('/api/admin/ai-provider/test',{method:'POST',credentials:'include'})"
Write-Host "    .then(r=>r.json()).then(console.log)"
Write-Host "Expect: { success: true, ... }"
