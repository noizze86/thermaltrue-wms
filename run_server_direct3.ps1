$env:DATABASE_URL = "postgresql://postgres@localhost:5432/thermaltrue?sslmode=disable"
$env:JWT_SECRET = "25532fa5e9ce443a2d806993234f67536ee0632d7014e736dbe04c46da51252e"
$env:PORT = "3000"
$env:RUST_LOG = "debug"
$proc = Start-Process -FilePath "C:\Program Files\Thermaltrue\server.exe" -ArgumentList "run" -NoNewWindow -RedirectStandardOutput "C:\test wms\thermaltrue\server_out3.txt" -RedirectStandardError "C:\test wms\thermaltrue\server_err3.txt" -PassThru
Start-Sleep -Seconds 15
if (!$proc.HasExited) {
    $proc.Kill()
    "Process still running after 15s, killed (healthy)" | Out-File "C:\test wms\thermaltrue\server_run_log3.txt"
} else {
    "Exit code: $($proc.ExitCode)" | Out-File "C:\test wms\thermaltrue\server_run_log3.txt"
}
