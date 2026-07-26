@echo off
echo ========================================
echo Thermaltrue - Deploy SKU Query Fix
echo ========================================
echo.
echo Please RUN THIS FILE AS ADMINISTRATOR!
echo (Right-click - Run as Administrator)
echo.
echo This will:
echo 1. Stop ThermaltrueServer service
echo 2. Copy new server.exe to Program Files
echo 3. Start ThermaltrueServer service
echo.
echo Press any key to proceed, or close this window to cancel.
pause >nul

echo Stopping service...
sc.exe stop ThermaltrueServer
timeout /t 3 /nobreak >nul

echo Copying server.exe...
copy /Y "C:\test wms\thermaltrue\target\release\server.exe" "C:\Program Files\Thermaltrue\server.exe"

echo Starting service...
sc.exe start ThermaltrueServer
timeout /t 3 /nobreak >nul

sc.exe query ThermaltrueServer

echo.
echo Done! Press any key to exit.
pause >nul
