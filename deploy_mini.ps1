sc stop ThermaltrueServer; start-sleep 3; copy-item 'C:\test wms\thermaltrue\target\release\server.exe' 'C:\Program Files\Thermaltrue\server.exe' -force; sc start ThermaltrueServer
