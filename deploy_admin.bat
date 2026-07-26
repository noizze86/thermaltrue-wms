@echo off
echo === Deploying Thermaltrue ===

echo Stopping service...
sc.exe stop ThermaltrueServer
timeout /t 3 /nobreak >nul

echo Copying server.exe...
copy /Y "C:\test wms\thermaltrue\target\release\server.exe" "C:\Program Files\Thermaltrue\server.exe"

echo Deploying frontend dist...
rmdir /S /Q "C:\Program Files\Thermaltrue\dist"
xcopy /E /I /Y "C:\test wms\thermaltrue\dist" "C:\Program Files\Thermaltrue\dist"

echo Starting service...
sc.exe start ThermaltrueServer
timeout /t 3 /nobreak >nul

echo === Checking status ===
sc.exe query ThermaltrueServer

echo.
echo Done! Press any key to exit.
pause >nul
