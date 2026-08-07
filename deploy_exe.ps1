$ErrorActionPreference = "Stop"
try {
    Write-Host "Stopping service..."
    Stop-Service ThermaltrueServer -Force
    Start-Sleep -Seconds 5
    
    Write-Host "Copying server.exe..."
    Copy-Item -LiteralPath "C:\test wms\thermaltrue\target\release\server.exe" -Destination "C:\Program Files\Thermaltrue\server.exe" -Force
    
    Write-Host "Starting service..."
    Start-Service ThermaltrueServer
    
    Write-Host "Done"
    exit 0
} catch {
    Write-Host "Error: $_"
    exit 1
}
