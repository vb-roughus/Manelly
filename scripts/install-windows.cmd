@echo off
rem Installs Manelly on this PC as a program with an icon on the desktop: double-click
rem this file or run it in a terminal, e.g. "scripts\install-windows.cmd -Port 3001".
rem The execution policy is only bypassed for this one script. The window closes by itself
rem once all went well; after an error it stays open, so the message can be read.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1" %*
if errorlevel 1 pause
