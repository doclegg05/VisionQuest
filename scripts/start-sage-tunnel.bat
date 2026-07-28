@echo off
REM Start the installed VisionQuest local-AI Windows services.
REM Run scripts\install-local-ai-services.ps1 from elevated PowerShell first.

net start VisionQuest-Ollama
net start VisionQuest-OllamaRelay
net start cloudflared

sc query VisionQuest-Ollama
sc query VisionQuest-OllamaRelay
sc query cloudflared
