# Self-elevate
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
  Start-Process powershell.exe "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
  exit
}

$log = "C:\test wms\thermaltrue\deploy_log.txt"
"=== Deploy started $(Get-Date) ===" | Out-File $log

"1. Stopping service via sc.exe..." | Out-File $log -Append
sc.exe stop ThermaltrueServer 2>&1 | Out-File $log -Append
Start-Sleep -Seconds 3

"2. Killing any remaining server processes..." | Out-File $log -Append
Get-Process -Name "server" -ErrorAction SilentlyContinue | ForEach-Object { taskkill /f /pid $_.Id 2>&1 | Out-File $log -Append }
Start-Sleep -Seconds 2

"3. Copying server.exe..." | Out-File $log -Append
Copy-Item -Path "C:\test wms\thermaltrue\target\release\server.exe" -Destination "C:\Program Files\Thermaltrue\server.exe" -Force 2>&1 | Out-File $log -Append

"4. Starting service..." | Out-File $log -Append
sc.exe start ThermaltrueServer 2>&1 | Out-File $log -Append
Start-Sleep -Seconds 3

"5. Service status:" | Out-File $log -Append
sc.exe query ThermaltrueServer 2>&1 | Out-File $log -Append

"Done!" | Out-File $log -Append
