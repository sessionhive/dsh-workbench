@echo off
chcp 65001 >nul
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required. Install it from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

node scripts\setup.mjs %*
if errorlevel 1 (
  echo.
  echo Setup failed. Review the messages above, then run this file again.
  pause
  exit /b 1
)

echo.
echo Setup finished. This window can be closed.
pause
