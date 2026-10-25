@echo off
rem Starts Manelly on Windows: double-click this file or run it in a terminal,
rem e.g. "scripts\start-windows.cmd -Port 3001". The execution policy is only
rem bypassed for this one script.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-windows.ps1" %*
if errorlevel 1 pause
