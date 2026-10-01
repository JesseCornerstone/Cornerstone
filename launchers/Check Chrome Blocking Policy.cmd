@echo off
setlocal

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if exist "%CHROME%" (
  start "" "%CHROME%" chrome://policy
) else (
  start "" chrome://policy
)

echo Chrome policy page opened.
echo Look for policies affecting Localhost, Private Network Access, URLBlocklist, URLAllowlist, or InsecurePrivateNetworkRequests.
pause
