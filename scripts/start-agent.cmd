@echo off
rem Installs and starts the Manelly agent on the Jellyfin server: double-click this
rem file or run it in a terminal, e.g. "scripts\start-agent.cmd -Install". The
rem execution policy is only bypassed for this one script.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-agent.ps1" %*
if errorlevel 1 pause
