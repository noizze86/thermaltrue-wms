$LogFile = "C:\test wms\thermaltrue\deploy_log.txt"
"=== Deploy started at $(Get-Date) ===" | Out-File $LogFile
$ErrorActionPreference = "Stop"
try {
    "Stopping service..." | Out-File $LogFile -Append
    $result = sc.exe stop ThermaltrueServer 2>&1
    "$result" | Out-File $LogFile -Append
    Start-Sleep -Seconds 5
    
    "Killing any remaining processes..." | Out-File $LogFile -Append
    Get-Process -Name server -ErrorAction SilentlyContinue | Stop-Process -Force
    
    "Copying server.exe..." | Out-File $LogFile -Append
    $src = "C:\test wms\thermaltrue\target\release\server.exe"
    $dst = "C:\Program Files\Thermaltrue\server.exe"
    if (Test-Path $src) { "Source exists, size: $((Get-Item $src).Length)" | Out-File $LogFile -Append }
    Copy-Item -LiteralPath $src -Destination $dst -Force
    "Copy done. Dest size: $((Get-Item $dst).Length)" | Out-File $LogFile -Append
    
    "Copying dist..." | Out-File $LogFile -Append
    Remove-Item -LiteralPath "C:\Program Files\Thermaltrue\dist" -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -LiteralPath "C:\test wms\thermaltrue\dist" -Destination "C:\Program Files\Thermaltrue\dist" -Recurse -Force
    
    "Starting service..." | Out-File $LogFile -Append
    $result = sc.exe start ThermaltrueServer 2>&1
    "$result" | Out-File $LogFile -Append
    
    "=== Deploy complete ===" | Out-File $LogFile -Append
} catch {
    "ERROR: $_" | Out-File $LogFile -Append
}
