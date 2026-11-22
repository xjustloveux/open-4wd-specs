@echo off
setlocal
pwsh -NoProfile -File "%~dp0scripts\prepare-authoring-release.ps1" %*
exit /b %ERRORLEVEL%
