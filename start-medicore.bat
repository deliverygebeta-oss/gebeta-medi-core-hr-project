@echo off
rem ============================================================
rem  MediCore HR - one-click dev launcher
rem  Opens the API (Hono, port 3000) and the web app (SvelteKit,
rem  port 5173) in two separate windows so each has its own logs
rem  and can be stopped individually with Ctrl+C.
rem ============================================================

rem bun is not always on PATH in fresh shells - prepend its home.
rem Children started below inherit this PATH.
set "PATH=%USERPROFILE%\.bun\bin;%PATH%"

where bun >nul 2>nul
if errorlevel 1 (
    echo [ERROR] bun was not found. Install it from https://bun.sh and retry.
    pause
    exit /b 1
)

rem Warn (do not block) if the ports already have listeners -
rem usually a leftover server from an earlier session.
netstat -ano | findstr /c:":3000 " | findstr /c:"LISTENING" >nul && (
    echo [WARN] Something is already listening on port 3000 - the API window may show EADDRINUSE.
)
netstat -ano | findstr /c:":5173 " | findstr /c:"LISTENING" >nul && (
    echo [WARN] Something is already listening on port 5173 - the web window may show EADDRINUSE.
)

echo Starting MediCore HR API  ^(http://localhost:3000^) ...
start "MediCore API - port 3000" cmd /k "cd /d "%~dp0apps\api" && bun run dev"

echo Starting MediCore HR Web  ^(http://localhost:5173^) ...
start "MediCore Web - port 5173" cmd /k "cd /d "%~dp0apps\web" && bun run dev"

echo.
echo Both services are starting in their own windows.
echo   API:  http://localhost:3000/api/health
echo   Web:  http://localhost:5173
echo Close those windows (or Ctrl+C inside them) to stop the servers.
timeout /t 6 >nul
