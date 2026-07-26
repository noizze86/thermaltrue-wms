# Self-elevate
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
  Start-Process powershell.exe "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
  exit
}

Write-Host "Stopping service..."
sc.exe stop ThermaltrueServer
Start-Sleep -Seconds 3

Write-Host "Copying server.exe..."
Copy-Item -Path "C:\test wms\thermaltrue\target\release\server.exe" -Destination "C:\Program Files\Thermaltrue\server.exe" -Force

Write-Host "Starting service..."
sc.exe start ThermaltrueServer
Start-Sleep -Seconds 2

sc.exe query ThermaltrueServer

Write-Host "`nDone!"
Read-Host "Press Enter to exit"
