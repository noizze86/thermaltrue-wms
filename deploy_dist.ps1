if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"" + $MyInvocation.MyCommand.Path + "`""
    Start-Process powershell -Verb RunAs -ArgumentList $arguments
    exit
}

Write-Host "=== Deploying frontend dist (Admin) ==="
$distSrc = "C:\test wms\thermaltrue\dist"
$distDst = "C:\Program Files\Thermaltrue\dist"
Write-Host "Deploying dist: $distSrc"
Remove-Item -LiteralPath $distDst -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -LiteralPath $distSrc -Destination $distDst -Recurse -Force

$updated = Get-Item -LiteralPath "$distDst\index.html"
Write-Host "dist/index.html size: $($updated.Length), time: $($updated.LastWriteTime)"

Get-ChildItem -LiteralPath "$distDst\assets" -Filter "*.js" | Select-Object Name, Length, LastWriteTime

Write-Host "=== Deploy complete ==="
Read-Host "Press Enter to exit"
