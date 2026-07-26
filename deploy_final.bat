@echo off
echo === Deploy Thermaltrue ===

echo 1. Stopping service via sc...
sc.exe stop ThermaltrueServer
timeout /t 5 /nobreak >nul

echo 2. Force killing server.exe process...
taskkill /f /im server.exe
timeout /t 3 /nobreak >nul

echo 3. Copying server.exe...
copy /Y "C:\test wms\thermaltrue\target\release\server.exe" "C:\Program Files\Thermaltrue\server.exe"

echo 4. Starting service...
sc.exe start ThermaltrueServer
timeout /t 3 /nobreak >nul

echo 5. Status:
sc.exe query ThermaltrueServer

echo.
echo Done!
pause
