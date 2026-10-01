@echo off
setlocal

for %%I in ("%~dp0..") do set "SOURCE=%%~fI"
set "TARGET=%LOCALAPPDATA%\CornerstoneMapping\QLD Mapping"
set "COPY_LOG=%TEMP%\CornerstoneMappingLocalCopy.log"
set "PAGE=%~1"
if "%PAGE%"=="" set "PAGE=Index.html"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run the local mapping site.
  echo Install the LTS version from https://nodejs.org/ and try again.
  pause
  exit /b 1
)

if /I not "%SOURCE%"=="%TARGET%" (
  echo Copying mapping site out of OneDrive...
  echo From: %SOURCE%
  echo To:   %TARGET%
  if exist "%COPY_LOG%" del /q "%COPY_LOG%" >nul 2>nul
  robocopy "%SOURCE%" "%TARGET%" /E /XJ /FFT /R:1 /W:1 /COPY:DAT /DCOPY:DAT /XD node_modules .git .openai /XF *.log local-server-status.js local-static-server.out.log local-static-server.err.log /NFL /NDL /NP > "%COPY_LOG%" 2>&1
  if errorlevel 8 (
    echo Failed to copy the site out of OneDrive.
    echo Copy log: %COPY_LOG%
    if exist "%COPY_LOG%" type "%COPY_LOG%"
    echo Try right-clicking the Lot Companion folder in OneDrive and choosing "Always keep on this device".
    pause
    exit /b 1
  )
)

cd /d "%TARGET%"

set "CHROME_USER_DATA_DIR=%TEMP%\CornerstoneMappingChrome"
set "CHROME_EXTRA_ARGS=--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights --allow-insecure-localhost --explicitly-allowed-ports=4173,4174,4175,4176,4177,4178,4179,4180,4181,4182,4183,4184,4185,4186,4187,4188,4189,4190,4191,4192,4193,5173,5174,3000,3001,3002,8080,8081,8888,5500,5501,7000,7001,9000,9001"

node mapping-app.js "%PAGE%"
if errorlevel 1 pause
