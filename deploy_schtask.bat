@echo off
net stop ThermaltrueServer 2>nul
timeout /t 5 /nobreak >nul
copy /Y "C:\test wms\thermaltrue\target\release\server.exe" "C:\Program Files\Thermaltrue\server.exe"
echo Copy result: %errorlevel%
net start ThermaltrueServer 2>nul
echo Done.
