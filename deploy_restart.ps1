# Kill all server processes first
Get-Process -Name server -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3

# Verify port is free
$busy = netstat -ano | Select-String ":3000 "
if ($busy) { "Port 3000 still in use!"; exit 1 }

# Start the service
$result = sc.exe start ThermaltrueServer 2>&1
$result

Start-Sleep -Seconds 15
$svc = Get-Service ThermaltrueServer
"Service status: $($svc.Status)"
if ($svc.Status -eq "Running") {
    # Test the API
    Start-Sleep -Seconds 3
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:3000/api/health" -UseBasicParsing -TimeoutSec 10
        "API health: $($r.StatusCode) $($r.Content)"
    } catch { "API error: $_" }
}
