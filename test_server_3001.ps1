# Kill zombie and stop service
Stop-Process -Id 9224 -Force -ErrorAction SilentlyContinue
Stop-Process -Name server -Force -ErrorAction SilentlyContinue
sc.exe stop ThermaltrueServer 2>&1 | Out-Null
Start-Sleep -Seconds 5

# Now run the server on a different port to verify
$env:DATABASE_URL = "postgresql://postgres@localhost:5432/thermaltrue?sslmode=disable"
$env:JWT_SECRET = "25532fa5e9ce443a2d806993234f67536ee0632d7014e736dbe04c46da51252e"
$env:PORT = "3001"
$env:RUST_LOG = "debug"
$proc = Start-Process -FilePath "C:\Program Files\Thermaltrue\server.exe" -ArgumentList "run" -NoNewWindow -RedirectStandardOutput "C:\test wms\thermaltrue\server_out_3001.txt" -RedirectStandardError "C:\test wms\thermaltrue\server_err_3001.txt" -PassThru
Start-Sleep -Seconds 15
if (!$proc.HasExited) {
    $proc.Kill()
    "Process started OK on port 3001, was running for 15s" | Out-File "C:\test wms\thermaltrue\server_run_3001.txt"
    # Test the API
    try { $r = Invoke-WebRequest -Uri "http://localhost:3001/api/health" -UseBasicParsing -TimeoutSec 5; "API response: $($r.Content)" | Out-File "C:\test wms\thermaltrue\server_run_3001.txt" -Append } catch { "API error: $_" | Out-File "C:\test wms\thermaltrue\server_run_3001.txt" -Append }
} else {
    "Exit code: $($proc.ExitCode)" | Out-File "C:\test wms\thermaltrue\server_run_3001.txt"
}
