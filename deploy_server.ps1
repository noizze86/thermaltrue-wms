$log = "C:\test wms\thermaltrue\deploy_log.txt"
"Starting at $(Get-Date)" | Out-File $log
try {
  "Stopping service..." | Out-File $log -Append
  Stop-Service ThermaltrueServer -Force -ErrorAction Stop
  "Stopped." | Out-File $log -Append
  Start-Sleep -Seconds 5
  "Copying file..." | Out-File $log -Append
  Copy-Item -LiteralPath "C:\test wms\thermaltrue\target\release\server.exe" -Destination "C:\Program Files\Thermaltrue\server.exe" -Force
  "Copied." | Out-File $log -Append
  "Starting service..." | Out-File $log -Append
  Start-Service ThermaltrueServer
  "Started." | Out-File $log -Append
} catch {
  "ERROR: $_" | Out-File $log -Append
}
"Done at $(Get-Date)" | Out-File $log -Append
