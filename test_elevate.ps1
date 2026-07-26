$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")
if (-not $isAdmin) {
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`""
    exit
}
"Running as admin at $(Get-Date)" | Out-File "C:\Program Files\Thermaltrue\admin_test.txt" -Force
Write-Host "Admin test file created"
Start-Sleep -Seconds 5
