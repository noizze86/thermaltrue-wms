$ErrorActionPreference = "Stop"
try {
    Write-Host "=== Deploying server binary ==="
    Write-Host "Stopping service..."
    sc.exe stop ThermaltrueServer
    Start-Sleep -Seconds 5
    
    Write-Host "Killing process..."
    Get-Process -Name server -ErrorAction SilentlyContinue | Stop-Process -Force
    
    Write-Host "Copying server.exe..."
    Copy-Item -LiteralPath "C:\test wms\thermaltrue\target\release\server.exe" -Destination "C:\Program Files\Thermaltrue\server.exe" -Force
    
    Write-Host "Copying dist..."
    Remove-Item -LiteralPath "C:\Program Files\Thermaltrue\dist" -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -LiteralPath "C:\test wms\thermaltrue\dist" -Destination "C:\Program Files\Thermaltrue\dist" -Recurse -Force
    
    Write-Host "Starting service..."
    sc.exe start ThermaltrueServer
    
    Write-Host "=== Deploy complete ==="
    Get-Service ThermaltrueServer | Format-Table Name, Status
} catch {
    Write-Host "ERROR: $_"
    Start-Sleep -Seconds 30
    exit 1
}
