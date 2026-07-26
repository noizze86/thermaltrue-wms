$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")
if (-not $isAdmin) {
    $psFile = $MyInvocation.MyCommand.Path
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$psFile`""
    exit
}
echo "Deploying server.exe..."
Stop-Service ThermaltrueServer -Force
Start-Sleep -Seconds 3
Copy-Item "C:\test wms\thermaltrue\target\release\server.exe" "C:\Program Files\Thermaltrue\server.exe" -Force
Start-Service ThermaltrueServer
Start-Sleep -Seconds 2
$svc = Get-Service ThermaltrueServer
echo "Status: $($svc.Status)"
$f = Get-Item "C:\Program Files\Thermaltrue\server.exe"
echo "File: $($f.Length) bytes, $($f.LastWriteTime)"
echo "Done"
