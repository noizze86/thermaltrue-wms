net stop ThermaltrueServer
Start-Sleep 3
Copy-Item "C:\test wms\thermaltrue\target\release\server.exe" "C:\Program Files\Thermaltrue\server.exe" -Force
net start ThermaltrueServer
