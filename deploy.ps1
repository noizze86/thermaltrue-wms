# Deploy script - run as Administrator
Write-Host "=== Deploying Thermaltrue ==="

# Stop service
sc.exe stop ThermaltrueServer
Start-Sleep -Seconds 2

# Kill lingering process
Get-Process -Name server -ErrorAction SilentlyContinue | Stop-Process -Force

# Copy server.exe
Copy-Item -LiteralPath "C:\test wms\thermaltrue\target\release\server.exe" -Destination "C:\Program Files\Thermaltrue\server.exe" -Force

# Copy frontend dist
Remove-Item -LiteralPath "C:\Program Files\Thermaltrue\dist" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -LiteralPath "C:\test wms\thermaltrue\dist" -Destination "C:\Program Files\Thermaltrue\dist" -Recurse -Force

# Start service
sc.exe start ThermaltrueServer

Write-Host "=== Deploy complete ==="
Start-Sleep -Seconds 3
Get-Service ThermaltrueServer | Format-Table Name, Status
