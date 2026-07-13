@echo off
echo Installing Thermaltrue Server...
copy /Y "C:\test wms\thermaltrue\target\release\server.exe" "C:\Program Files\Thermaltrue\server.exe"
"C:\Program Files\Thermaltrue\server.exe" install
"C:\Program Files\Thermaltrue\server.exe" start
echo Done.
pause
