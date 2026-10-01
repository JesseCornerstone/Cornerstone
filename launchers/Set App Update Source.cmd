@echo off
setlocal

for %%I in ("%~dp0..") do set "APP_ROOT=%%~fI"
cd /d "%APP_ROOT%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to configure the mapping app.
  echo Install the LTS version from https://nodejs.org/ and try again.
  pause
  exit /b 1
)

node configure-update-source.js
pause
