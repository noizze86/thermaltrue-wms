param([string]$cmd)
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "powershell.exe"
$psi.Arguments = "-NoProfile -Command & { $cmd }"
$psi.Verb = "runas"
$psi.UseShellExecute = $true
$psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Normal
try {
    $p = [System.Diagnostics.Process]::Start($psi)
    Write-Host "Started PID: $($p.Id)"
    $p.WaitForExit()
    Write-Host "Exit code: $($p.ExitCode)"
} catch {
    Write-Host "Error: $_"
}
