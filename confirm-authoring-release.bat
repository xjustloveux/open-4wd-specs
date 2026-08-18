@echo off
setlocal
pwsh -NoProfile -File "%~dp0scripts\publish-authoring-release.ps1" -Publish -ConfirmImmutablePublish "%~1"
exit /b %ERRORLEVEL%
