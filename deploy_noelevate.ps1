net stop ThermaltrueServer 2>$null
Start-Sleep 3
$running = Get-Process -Name server -ErrorAction SilentlyContinue
if ($running) { $running | Stop-Process -Force }
Copy-Item "C:\test wms\thermaltrue\target\release\server.exe" "C:\Program Files\Thermaltrue\server.exe" -Force
net start ThermaltrueServer 2>$null
