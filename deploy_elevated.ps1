# Self-elevating deploy script
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"" + $MyInvocation.MyCommand.Path + "`""
    Start-Process powershell -Verb RunAs -ArgumentList $arguments
    exit
}

Write-Host "=== Deploying Thermaltrue (Admin) ==="

# Stop service
Write-Host "Stopping service..."
sc.exe stop ThermaltrueServer
Start-Sleep -Seconds 3

# Kill lingering process
Get-Process -Name server -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# Copy server binary
$src = "C:\test wms\thermaltrue\target\release\server.exe"
$dst = "C:\Program Files\Thermaltrue\server.exe"
Write-Host "Copying: $src -> $dst"
Copy-Item -LiteralPath $src -Destination $dst -Force

# Copy dist folder
$distSrc = "C:\test wms\thermaltrue\dist"
$distDst = "C:\Program Files\Thermaltrue\dist"
Write-Host "Deploying dist: $distSrc -> $distDst"
Remove-Item -LiteralPath $distDst -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -LiteralPath $distSrc -Destination $distDst -Recurse -Force

# Start service
Write-Host "Starting service..."
sc.exe start ThermaltrueServer
Start-Sleep -Seconds 2

# Verify
$svc = Get-Service ThermaltrueServer
Write-Host "Service status: $($svc.Status)"

$updated = Get-Item -LiteralPath $dst
Write-Host "Server.exe size: $($updated.Length), time: $($updated.LastWriteTime)"

Write-Host "=== Deploy complete ==="
Read-Host "Press Enter to exit"
