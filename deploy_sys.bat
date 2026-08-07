net stop ThermaltrueServer
timeout /t 5 /nobreak
copy /Y "C:\test wms\thermaltrue\target\release\server.exe" "C:\Program Files\Thermaltrue\server.exe"
net start ThermaltrueServer
schtasks /delete /tn "ThermaltrueDeploy" /f
