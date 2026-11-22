@echo off
setlocal
cd /d "%~dp0"
pnpm run authoring:animation:build -- %*
exit /b %ERRORLEVEL%
