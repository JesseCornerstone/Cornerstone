@echo off
setlocal
for %%I in ("%~dp0..") do set "APP_ROOT=%%~fI"
cd /d "%APP_ROOT%"
set "PAGE=%~1"
if "%PAGE%"=="" set "PAGE=BCC.html"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required for this diagnostic.
  pause
  exit /b 1
)

node diagnose-local-port.js "%PAGE%"
pause
