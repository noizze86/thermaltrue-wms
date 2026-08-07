$log = "C:\Users\NANARU~1\AppData\Local\Temp\opencode\deploy-audit-log.txt"
function Log($msg) {
    $line = "[$(Get-Date -Format 'HH:mm:ss')] $msg"
    Add-Content -LiteralPath $log -Value $line
}

if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"" + $MyInvocation.MyCommand.Path + "`""
    Start-Process powershell -Verb RunAs -ArgumentList $arguments
    exit
}

Remove-Item -LiteralPath $log -Force -ErrorAction SilentlyContinue
Log "=== Deploy audit-log fix (Admin) ==="

sc.exe stop ThermaltrueServer | Out-Null
Log "sc stop: exit=$LASTEXITCODE"
Start-Sleep -Seconds 3

Get-Process -Name server -ErrorAction SilentlyContinue | ForEach-Object {
    Log "Stopping server.exe PID $($_.Id)"
    taskkill /F /PID $_.Id 2>&1 | Out-Null
}
Start-Sleep -Seconds 2

$dst = "C:\Program Files\Thermaltrue\server.exe"
if (Test-Path -LiteralPath "$dst.old") { Remove-Item -LiteralPath "$dst.old" -Force }
Rename-Item -LiteralPath $dst -NewName "server.exe.old" -Force -ErrorAction SilentlyContinue
Log "rename trick done"

Copy-Item -LiteralPath "C:\test wms\thermaltrue\target\release\server.exe" -Destination $dst -Force
$b = Get-Item -LiteralPath $dst
Log "server.exe copied: $($b.Length) bytes, $($b.LastWriteTime)"

$distDst = "C:\Program Files\Thermaltrue\dist"
Remove-Item -LiteralPath $distDst -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -LiteralPath "C:\test wms\thermaltrue\dist" -Destination $distDst -Recurse -Force
Log "dist deployed: $((Get-ChildItem -LiteralPath $distDst -Recurse -File).Count) files"

sc.exe start ThermaltrueServer | Out-Null
Log "sc start: exit=$LASTEXITCODE"
Start-Sleep -Seconds 5

$svc = Get-Service ThermaltrueServer
Log "Service status: $($svc.Status)"
Log "=== Deploy complete ==="
