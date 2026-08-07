$log = "C:\test wms\thermaltrue\deploy_log.txt"
"Starting deploy at $(Get-Date)" | Out-File $log
try {
    net stop ThermaltrueServer 2>&1 | Out-File $log -Append
    Start-Sleep 3
    copy-item "C:\test wms\thermaltrue\target\release\server.exe" "C:\Program Files\Thermaltrue\server.exe" -Force 2>&1 | Out-File $log -Append
    net start ThermaltrueServer 2>&1 | Out-File $log -Append
    "Done at $(Get-Date)" | Out-File $log -Append
} catch {
    $_.Exception.Message | Out-File $log -Append
}
