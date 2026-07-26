@echo off
cd /d "%~dp0"
echo === Deploying Thermaltrue SKU Query Fix ===
sc.exe stop ThermaltrueServer
timeout /t 3 /nobreak >nul
copy /Y "target\release\server.exe" "C:\Program Files\Thermaltrue\server.exe"
sc.exe start ThermaltrueServer
timeout /t 3 /nobreak >nul
echo Done!
