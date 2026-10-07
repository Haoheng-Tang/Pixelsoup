@echo off
rem Starts Pixelsoup on Windows. Runs the dev server (as npm run dev does) in this window and
rem opens the app in its own Microsoft Edge window, or in the default browser if Edge is missing.
rem Closing this window stops the server. If Pixelsoup is already running, it only opens
rem another window. The URL and the title check must match the dev server and index.html.
setlocal
cd /d "%~dp0"
set "PIXELSOUP_URL=http://localhost:5173/"
if "%~1"=="--open-when-ready" goto open_when_ready

call :is_running && goto open_window

where node >nul 2>nul
if errorlevel 1 (
  echo Pixelsoup needs Node.js 22.13+, 24.x or 26+, with npm: https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
  echo Installing dependencies. The first time takes a minute or two...
  call npm ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

title Pixelsoup
echo Starting Pixelsoup. Keep this window open while you use it; close it to quit.
rem A background job in this window opens the app once the server answers.
start "" /b cmd /d /c ""%~f0" --open-when-ready"
rem Runs Vite itself rather than through npm, whose shims reset this window's title.
node node_modules\vite\bin\vite.js --strictPort
if errorlevel 1 pause
exit /b

:open_when_ready
for /l %%i in (1,1,30) do (
  call :is_running && goto open_window
  ping -n 2 127.0.0.1 >nul
)
exit /b 1

:open_window
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe" >nul 2>nul
if errorlevel 1 (
  start "" "%PIXELSOUP_URL%"
) else (
  start "" msedge --app=%PIXELSOUP_URL%
)
exit /b 0

:is_running
"%SystemRoot%\System32\curl.exe" -s --connect-timeout 1 -m 5 --noproxy "*" "%PIXELSOUP_URL%" 2>nul | findstr /c:"<title>Pixelsoup</title>" >nul
exit /b
