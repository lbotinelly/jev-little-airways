@echo off
setlocal
rem Little Airways stopper — kills whatever listens on the demo port.
rem Usage: stop.bat [port]     (default 8765)
set "PORT=%~1"
if "%PORT%"=="" set "PORT=8765"

set "PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%PORT% " ^| findstr "LISTENING"') do set "PID=%%P"

if not defined PID (
  echo Little Airways is not running.
  exit /b 0
)

taskkill /PID %PID% /T /F >nul 2>&1
if errorlevel 1 (
  echo Could not stop process %PID%. Try closing it manually.
  exit /b 1
)
echo Little Airways stopped (process %PID%).
exit /b 0
