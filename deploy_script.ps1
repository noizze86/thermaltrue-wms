Stop-Service ThermaltrueServer -Force -ErrorAction SilentlyContinue
Start-Sleep 8
Copy-Item -LiteralPath "C:\test wms\thermaltrue\target\release\server.exe" -Destination "C:\Program Files\Thermaltrue\server.exe" -Force -ErrorAction Stop -PassThru | Select-Object Name,Length,LastWriteTime | Out-File C:\deploy_result.txt -Encoding UTF8
Start-Service ThermaltrueServer
