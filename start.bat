@echo off
setlocal
rem Little Airways launcher — starts the demo server (with the /jev proxy) and opens the demo.
rem Usage: start.bat [port]     (default 8765)
set "PORT=%~1"
if "%PORT%"=="" set "PORT=8765"
cd /d "%~dp0demo"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required but was not found on PATH. Install from https://nodejs.org
  exit /b 1
)

netstat -ano | findstr /r /c:":%PORT% " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo Little Airways is already running at http://localhost:%PORT%
  start "" "http://localhost:%PORT%"
  exit /b 0
)

echo Starting Little Airways on port %PORT% ...
powershell -NoProfile -Command "Start-Process cmd -ArgumentList '/c','node server.mjs %PORT% > server.log 2>&1' -WindowStyle Hidden" >nul 2>&1

set /a TRIES=0
:waitloop
ping -n 2 127.0.0.1 >nul
netstat -ano | findstr /r /c:":%PORT% " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto ready
set /a TRIES+=1
if %TRIES% lss 10 goto waitloop
echo The server did not come up. Check demo\server.log
exit /b 1

:ready
start "" "http://localhost:%PORT%"
echo Little Airways is running at http://localhost:%PORT%  (logs: demo\server.log)
echo Stop it with stop.bat
exit /b 0
