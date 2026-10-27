@echo off
setlocal

for %%I in ("%~dp0..") do set "APP_ROOT=%%~fI"
cd /d "%APP_ROOT%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run the VA integration smoke test.
  echo Install the LTS version from https://nodejs.org/ and try again.
  pause
  exit /b 1
)

node scripts\test-va-integration.js
if errorlevel 1 (
  pause
  exit /b 1
)

pause
