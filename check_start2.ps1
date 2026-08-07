$result = sc.exe start ThermaltrueServer 2>&1
$result | Out-File "C:\test wms\thermaltrue\service_start_log.txt"
Start-Sleep -Seconds 15
$service = Get-Service ThermaltrueServer
"Status: $($service.Status)" | Out-File "C:\test wms\thermaltrue\service_start_log.txt" -Append
if ($service.Status -eq "Stopped") {
    Get-WinEvent -LogName System -MaxEvents 3 | Where-Object { $_.Id -eq 7031 -or $_.Id -eq 7034 } | Format-Table TimeCreated, Id, Message -Wrap | Out-File "C:\test wms\thermaltrue\service_start_log.txt" -Append
}
