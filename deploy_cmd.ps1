Stop-Service ThermaltrueServer -Force
Start-Sleep -Seconds 5
Copy-Item -LiteralPath "C:\test wms\thermaltrue\target\release\server.exe" -Destination "C:\Program Files\Thermaltrue\server.exe" -Force
Start-Service ThermaltrueServer
