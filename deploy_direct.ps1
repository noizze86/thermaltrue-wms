Stop-Service ThermaltrueServer -Force
Start-Sleep -Seconds 3
Copy-Item "C:\test wms\thermaltrue\target\release\server.exe" "C:\Program Files\Thermaltrue\server.exe" -Force
Start-Service ThermaltrueServer
