@echo off
REM Start Sage Tunnel Services
REM This script starts the Ollama relay and cloudflared tunnel.
REM Ollama itself auto-starts via its Startup shortcut.
REM
REM Register as a scheduled task with:
REM   schtasks /create /tn "Sage Tunnel" /tr "C:\Users\Instructor\Dev\VisionQuest\scripts\start-sage-tunnel.bat" /sc onlogon /rl highest

echo [sage-tunnel] Starting Ollama keepalive relay...
start /min "Ollama Relay" cmd /c "node C:\Users\Instructor\Dev\VisionQuest\scripts\ollama-relay.mjs"

REM Wait for relay to start
timeout /t 3 /nobreak >nul

echo [sage-tunnel] Starting cloudflared tunnel...
start /min "Cloudflared Tunnel" cmd /c ""C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel run sage-ollama"

echo [sage-tunnel] Both services started.
