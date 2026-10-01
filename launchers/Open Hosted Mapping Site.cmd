@echo off
setlocal

set "BASE_URL=https://cornerstoneplus-hqhferewfdhsh4b0.australiaeast-01.azurewebsites.net"
set "PAGE=%~1"
if "%PAGE%"=="" set "PAGE=Index.html"
set "URL=%BASE_URL%/%PAGE%"

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" --new-window "%URL%"
  exit /b 0
)

set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" --new-window "%URL%"
  exit /b 0
)

set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" --new-window "%URL%"
  exit /b 0
)

start "" "%URL%"
