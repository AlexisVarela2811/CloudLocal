@echo off
taskkill /f /im CloudLocal.exe 2>nul
timeout /t 3 /nobreak >nul
cd /d D:\CloudLocal\launcher
node scripts\build.cjs
echo.
echo --- Done ---