net stop ThermaltrueServer
timeout /t 3 /nobreak >nul
copy /y "C:\test wms\thermaltrue\target\release\server.exe" "C:\Program Files\Thermaltrue\server.exe"
net start ThermaltrueServer
