@echo off
setlocal

for %%I in ("%~dp0..") do set "APP_ROOT=%%~fI"
cd /d "%APP_ROOT%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run the local mapping site.
  echo Install the LTS version from https://nodejs.org/ and try again.
  pause
  exit /b 1
)

set "PAGE=%~1"
if "%PAGE%"=="" set "PAGE=Index.html"

set "CHROME_USER_DATA_DIR=%TEMP%\CornerstoneMappingChrome"
set "CHROME_EXTRA_ARGS=--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights --allow-insecure-localhost --explicitly-allowed-ports=4173,4174,4175,4176,4177,4178,4179,4180,4181,4182,4183,4184,4185,4186,4187,4188,4189,4190,4191,4192,4193,5173,5174,3000,3001,3002,8080,8081,8888,5500,5501,7000,7001,9000,9001"

node mapping-app.js "%PAGE%"
if errorlevel 1 pause
