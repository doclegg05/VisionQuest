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

  Re-running is safe - each step checks for existing service state
  before changing it.
#>

[CmdletBinding()]
param(
  [string] $OllamaExe = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
  [string] $OllamaModels = "$env:USERPROFILE\.ollama\models",
  [string] $OllamaServiceName = "VisionQuest-Ollama",
  [string] $RelayScript = "C:\Users\Instructor\Dev\VisionQuest\scripts\ollama-relay.mjs",
  [string] $RelayServiceName = "VisionQuest-OllamaRelay",
  [string] $CloudflaredExe = "C:\Program Files (x86)\cloudflared\cloudflared.exe",
  [switch] $StopExistingProcesses
)

$ErrorActionPreference = "Stop"
$script:NssmPath = $null

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

function Resolve-NssmPath {
  $command = Get-Command nssm -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $candidates = @(
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links\nssm.exe",
    "$env:ProgramFiles\nssm\win64\nssm.exe",
    "$env:ProgramFiles\nssm\win32\nssm.exe",
    "${env:ProgramFiles(x86)}\nssm\win64\nssm.exe",
    "${env:ProgramFiles(x86)}\nssm\win32\nssm.exe"
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }

  return $null
}

function Wait-HttpOk($Uri, $TimeoutSeconds, $Label) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $r = Invoke-WebRequest -Uri $Uri -TimeoutSec 5 -UseBasicParsing
      if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) {
        return $r
      }
    } catch {
      # Keep waiting until the timeout expires.
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  throw "$Label did not become ready at $Uri within $TimeoutSeconds seconds."
}

function Get-PortOwnerProcesses($Port) {
  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($connection in $connections) {
    Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)" -ErrorAction SilentlyContinue
  }
}

function Test-ProcessBelongsToService($ProcessId, $ServiceName) {
  if (-not $ServiceName) { return $false }

  $service = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
  if (-not $service -or -not $service.ProcessId) { return $false }
  if ($ProcessId -eq $service.ProcessId) { return $true }

  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
  if (-not $process) { return $false }

  return $process.ParentProcessId -eq $service.ProcessId
}

function Assert-PortAvailableOrStopKnownProcess($Port, $Label, $KnownPattern, $ExpectedServiceName) {
  $owners = @(Get-PortOwnerProcesses $Port)
  if ($owners.Count -eq 0) { return }

  foreach ($owner in $owners) {
    if (Test-ProcessBelongsToService $owner.ProcessId $ExpectedServiceName) {
      Write-Host "  $Label port $Port is already owned by $ExpectedServiceName - keeping it."
      continue
    }

    $commandLine = [string] $owner.CommandLine
    if ($StopExistingProcesses -and $commandLine -match $KnownPattern) {
      Write-Host "  Stopping existing $Label process on port $Port (PID $($owner.ProcessId))."
      Stop-Process -Id $owner.ProcessId -Force
      Start-Sleep -Seconds 2
      continue
    }

    throw "$Label port $Port is already in use by PID $($owner.ProcessId): $commandLine. Re-run with -StopExistingProcesses after confirming the old foreground Sage/Ollama windows can be closed."
  }

  $remaining = @(Get-PortOwnerProcesses $Port | Where-Object {
    -not (Test-ProcessBelongsToService $_.ProcessId $ExpectedServiceName)
  })
  if ($remaining.Count -gt 0) {
    throw "$Label port $Port is still in use after stopping the known process."
  }
}

function Stop-ServiceIfPresent($ServiceName) {
  $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if (-not $service) { return }
  if ($service.Status -eq "Stopped") { return }

  Write-Host "  Stopping service $ServiceName..."
  try {
    Stop-Service -Name $ServiceName -Force -ErrorAction Stop
  } catch {
    Write-Host "  Stop-Service could not stop ${ServiceName}: $($_.Exception.Message)"
    if ($script:NssmPath -and (Test-Path $script:NssmPath)) {
      & $script:NssmPath stop $ServiceName confirm | Out-Null
    } else {
      & sc.exe stop $ServiceName | Out-Null
    }
  }

  $deadline = (Get-Date).AddSeconds(30)
  do {
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $service) { return }
    if ($service.Status -eq "Stopped") { return }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)

  throw "Service $ServiceName did not stop within 30 seconds."
}

function Start-ServiceIfNeeded($ServiceName, $TimeoutSeconds) {
  $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if (-not $service) {
    throw "Service $ServiceName is not installed."
  }
  if ($service.Status -eq "Running") { return }

  Write-Host "  Starting service $ServiceName..."
  Start-Service -Name $ServiceName -ErrorAction Stop

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $service) {
      throw "Service $ServiceName disappeared while starting."
    }
    if ($service.Status -eq "Running") { return }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)

  throw "Service $ServiceName did not start within $TimeoutSeconds seconds."
}

function Install-NssmServiceWithRetry($ServiceName, $Application, [string[]] $AppArguments) {
  $attempts = 12
  for ($attempt = 1; $attempt -le $attempts; $attempt++) {
    if ($AppArguments) {
      $output = & $script:NssmPath install $ServiceName $Application @AppArguments 2>&1
    } else {
      $output = & $script:NssmPath install $ServiceName $Application 2>&1
    }
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) { return }

    $message = ($output | Out-String).Trim()
    if ($message -match "marked for deletion") {
      if ($attempt -lt $attempts) {
        Write-Host "  Windows is still removing $ServiceName; retrying in 5 seconds ($attempt/$attempts)."
        Start-Sleep -Seconds 5
        continue
      }

      throw "$ServiceName is still marked for deletion by Windows. Reboot once, then re-run this script. NSSM output: $message"
    }

    throw "nssm install failed for $ServiceName (exit $exitCode). $message"
  }
}

function Stop-KnownForegroundProcesses {
  if (-not $StopExistingProcesses) { return }

  $patterns = @(
    "ollama app\.exe",
    "cloudflared\.exe.*tunnel run sage-ollama"
  )

  $processes = Get-CimInstance Win32_Process | Where-Object {
    $commandLine = [string] $_.CommandLine
    $matchesKnownProcess = $false
    foreach ($pattern in $patterns) {
      if ($commandLine -match $pattern) {
        $matchesKnownProcess = $true
        break
      }
    }
    $matchesKnownProcess
  }

  foreach ($process in $processes) {
    Write-Host "  Stopping existing foreground process PID $($process.ProcessId): $($process.CommandLine)"
    Stop-Process -Id $process.ProcessId -Force
  }

  if (@($processes).Count -gt 0) {
    Start-Sleep -Seconds 2
  }
}

Assert-Elevated

# ----------------------------------------------------------------------
Step 1 "Verify prerequisites"

if (-not (Test-Path $CloudflaredExe)) {
  throw "cloudflared not found at $CloudflaredExe. Install it from https://github.com/cloudflare/cloudflared/releases first."
}
if (-not (Test-Path $OllamaExe)) {
  throw "Ollama not found at $OllamaExe. Install Ollama first, then re-run this script."
}
if (-not (Test-Path $OllamaModels)) {
  throw "Ollama model directory not found at $OllamaModels. Pull the Sage model as this user first, or pass -OllamaModels with the correct model directory."
}
if (-not (Test-Path $RelayScript)) {
  throw "Relay script not found at $RelayScript."
}
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  throw "Node.js not found on PATH."
}
Write-Host "  cloudflared : $CloudflaredExe"
Write-Host "  ollama      : $OllamaExe"
Write-Host "  models      : $OllamaModels"
Write-Host "  relay       : $RelayScript"
Write-Host "  node        : $node"

Stop-KnownForegroundProcesses
Assert-PortAvailableOrStopKnownProcess 11435 "Relay" "ollama-relay\.mjs" $RelayServiceName
Assert-PortAvailableOrStopKnownProcess 11434 "Ollama" "ollama\.exe\s+serve" $OllamaServiceName

# ----------------------------------------------------------------------
Step 2 "Install NSSM (used to wrap the Node relay as a service)"

$nssm = Resolve-NssmPath
if ($nssm) {
  Write-Host "  NSSM already installed at $nssm - skipping."
} else {
  Write-Host "  Installing NSSM via winget..."
  & winget install --id NSSM.NSSM --silent --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    throw "winget install of NSSM failed (exit $LASTEXITCODE). Install manually from https://nssm.cc/download and re-run."
  }
  # winget puts NSSM under user-scope; rediscover.
  $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
  $nssm = Resolve-NssmPath
  if (-not $nssm) {
    throw "NSSM installed but not found on PATH. Open a new PowerShell window and re-run."
  }
  Write-Host "  NSSM installed at $nssm"
}
$script:NssmPath = $nssm

# ----------------------------------------------------------------------
Step 3 "Install Ollama as a Windows service"

Stop-ServiceIfPresent $RelayServiceName

$ollamaSvc = Get-Service -Name $OllamaServiceName -ErrorAction SilentlyContinue
if (-not $ollamaSvc) {
  Install-NssmServiceWithRetry $OllamaServiceName $OllamaExe @("serve")
  Write-Host "  $OllamaServiceName service installed."
} else {
  Write-Host "  $OllamaServiceName already present (status: $($ollamaSvc.Status)) - reconfiguring..."
  Stop-ServiceIfPresent $OllamaServiceName
  $ollamaSvc = Get-Service -Name $OllamaServiceName -ErrorAction SilentlyContinue
  if (-not $ollamaSvc) {
    Install-NssmServiceWithRetry $OllamaServiceName $OllamaExe @("serve")
    Write-Host "  $OllamaServiceName service reinstalled after Windows finished deleting the old registration."
  }
}

$logDir = "C:\ProgramData\VisionQuest\logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
& $nssm set $OllamaServiceName Application        $OllamaExe                         | Out-Null
& $nssm set $OllamaServiceName AppParameters     "serve"                            | Out-Null
& $nssm set $OllamaServiceName AppDirectory       (Split-Path $OllamaExe)             | Out-Null
& $nssm set $OllamaServiceName AppStdout          "$logDir\ollama-service.out.log"   | Out-Null
& $nssm set $OllamaServiceName AppStderr          "$logDir\ollama-service.err.log"   | Out-Null
& $nssm set $OllamaServiceName AppRotateFiles     1                                  | Out-Null
& $nssm set $OllamaServiceName AppRotateBytes     10485760                           | Out-Null
& $nssm set $OllamaServiceName AppExit Default    Restart                            | Out-Null
& $nssm set $OllamaServiceName AppRestartDelay    5000                               | Out-Null
& $nssm set $OllamaServiceName Start              SERVICE_AUTO_START                 | Out-Null
& $nssm set $OllamaServiceName AppEnvironmentExtra `
  "OLLAMA_HOST=127.0.0.1:11434" `
  "OLLAMA_MODELS=$OllamaModels" `
  "OLLAMA_KEEP_ALIVE=30m" `
  "OLLAMA_NUM_PARALLEL=4" `
  "OLLAMA_MAX_QUEUE=100" | Out-Null

Start-ServiceIfNeeded $OllamaServiceName 30
Wait-HttpOk "http://localhost:11434/api/tags" 60 "Ollama" | Out-Null
Write-Host "  $OllamaServiceName installed. Ollama endpoint is responding."

# ----------------------------------------------------------------------
Step 4 "Install cloudflared as a Windows service"

$cfSvc = Get-Service -Name "cloudflared" -ErrorAction SilentlyContinue
if ($cfSvc) {
  Write-Host "  cloudflared service already present (status: $($cfSvc.Status)) - skipping install."
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
Step 5 "Install the Ollama relay as a Windows service via NSSM"

$relaySvc = Get-Service -Name $RelayServiceName -ErrorAction SilentlyContinue
if (-not $relaySvc) {
  Install-NssmServiceWithRetry $RelayServiceName $node @($RelayScript)
  Write-Host "  $RelayServiceName service installed."
} else {
  Write-Host "  $RelayServiceName already present (status: $($relaySvc.Status)) - reconfiguring..."
  Stop-ServiceIfPresent $RelayServiceName
  $relaySvc = Get-Service -Name $RelayServiceName -ErrorAction SilentlyContinue
  if (-not $relaySvc) {
    Install-NssmServiceWithRetry $RelayServiceName $node @($RelayScript)
    Write-Host "  $RelayServiceName service reinstalled after Windows finished deleting the old registration."
  }
}

# Working dir + log files.
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
& $nssm set $RelayServiceName Application   $node                       | Out-Null
& $nssm set $RelayServiceName AppParameters $RelayScript                | Out-Null
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

# Make sure the relay starts after Ollama. cloudflared can connect before
# the relay is ready, but exposing a relay before Ollama is listening causes
# startup-only Sage failures.
& $nssm set $RelayServiceName DependOnService $OllamaServiceName        | Out-Null

Start-ServiceIfNeeded $RelayServiceName 30
Write-Host "  $RelayServiceName service installed and started."
Write-Host "  Logs: $logDir\ollama-relay.{out,err}.log"

# ----------------------------------------------------------------------
Step 6 "Smoke-test the chain"

Start-Sleep -Seconds 3

# 1. Ollama itself
try {
  $r = Wait-HttpOk "http://localhost:11434/api/tags" 30 "Ollama"
  Write-Host "  Ollama :11434 OK ($($r.StatusCode))"
} catch { throw "Ollama :11434 not responding: $($_.Exception.Message)" }

# 2. Relay
try {
  $r = Wait-HttpOk "http://localhost:11435/api/tags" 30 "Relay"
  Write-Host "  Relay  :11435 OK ($($r.StatusCode))"
} catch { throw "Relay :11435 not responding: $($_.Exception.Message)" }

# 3. Cloudflared service status (the tunnel may take 10-20s to register
# with Cloudflare's edge - we don't wait for that here).
$cf = Get-Service -Name "cloudflared"
Write-Host "  cloudflared service: $($cf.Status)"

# ----------------------------------------------------------------------
Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "Next: in a browser logged in as admin on visionquest.onrender.com, run"
Write-Host "  fetch('/api/admin/ai-provider/test',{method:'POST',credentials:'include'})"
Write-Host "    .then(r=>r.json()).then(console.log)"
Write-Host "Expect: { success: true, ... }"
