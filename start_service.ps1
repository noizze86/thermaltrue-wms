$result = sc.exe start ThermaltrueServer 2>&1
$result | Out-File "C:\test wms\thermaltrue\service_start_log.txt"
Start-Sleep -Seconds 5
$status = Get-Service ThermaltrueServer
"Service status after start: $($status.Status)" | Out-File "C:\test wms\thermaltrue\service_start_log.txt" -Append

# Also try running the server directly to capture error output
if ($status.Status -eq "Stopped") {
    "Server is still stopped. Trying direct execution..." | Out-File "C:\test wms\thermaltrue\service_start_log.txt" -Append
    $env:DATABASE_URL="postgresql://postgres@localhost:5432/thermaltrue?sslmode=disable"
    $env:JWT_SECRET="25532fa5e9ce443a2d806993234f67536ee0632d7014e736dbe04c46da51252e"
    $env:PORT="3000"
    $env:RUST_LOG="debug"
    $p = Start-Process -FilePath "C:\Program Files\Thermaltrue\server.exe" -ArgumentList "run" -NoNewWindow -RedirectStandardOutput "C:\test wms\thermaltrue\service_direct_out.txt" -RedirectStandardError "C:\test wms\thermaltrue\service_direct_err.txt" -PassThru -Wait -TimeoutSeconds 15
    "Exit code: $($p.ExitCode)" | Out-File "C:\test wms\thermaltrue\service_start_log.txt" -Append
}
