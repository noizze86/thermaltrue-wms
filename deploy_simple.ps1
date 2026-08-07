sc.exe stop ThermaltrueServer
Start-Sleep 3
taskkill /F /IM server.exe 2>$null
Copy-Item "C:\test wms\thermaltrue\target\release\server.exe" "C:\Program Files\Thermaltrue\server.exe" -Force
sc.exe start ThermaltrueServer
