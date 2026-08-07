$env:DATABASE_URL = "postgresql://postgres@localhost:5432/thermaltrue?sslmode=disable"
$env:JWT_SECRET = "25532fa5e9ce443a2d806993234f67536ee0632d7014e736dbe04c46da51252e"
$env:PORT = "3000"
$env:RUST_LOG = "debug"
$proc = Start-Process -FilePath "C:\Program Files\Thermaltrue\server.exe" -ArgumentList "run" -NoNewWindow -RedirectStandardOutput "C:\test wms\thermaltrue\server_out.txt" -RedirectStandardError "C:\test wms\thermaltrue\server_err.txt" -PassThru
Start-Sleep -Seconds 15
if (!$proc.HasExited) {
    $proc.Kill()
    "Process was still running after 15s, killed it" | Out-File "C:\test wms\thermaltrue\server_run_log.txt"
} else {
    "Process exited with code $($proc.ExitCode)" | Out-File "C:\test wms\thermaltrue\server_run_log.txt"
}
