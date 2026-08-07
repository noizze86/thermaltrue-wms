@echo off
echo TEST > C:\test-uac-works.txt
sc stop ThermaltrueServer
timeout /t 5 /nobreak
copy /Y "C:\test wms\thermaltrue\target\release\server.exe" "C:\Program Files\Thermaltrue\server.exe"
echo Copy exit code: %errorlevel%
sc start ThermaltrueServer
echo DONE >> C:\test-uac-works.txt
