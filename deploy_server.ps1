# Thermaltrue WMS — Deployment Script
# Jalankan sebagai Administrator!

$src = "C:\test wms\thermaltrue"
$dest = "C:\Program Files\Thermaltrue"

Write-Host "=== Thermaltrue WMS Deployment ===" -ForegroundColor Cyan

# 1. Stop service jika jalan
$svc = Get-Service -Name "ThermaltrueServer" -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Host "Menghentikan service..." -ForegroundColor Yellow
    sc.exe stop ThermaltrueServer
    Start-Sleep -Seconds 2
}

# 2. Copy binary
Write-Host "Copy server.exe..." -ForegroundColor Yellow
Copy-Item "$src\target\release\server.exe" "$dest\server.exe" -Force

# 3. Copy .env
Write-Host "Copy .env..." -ForegroundColor Yellow
Copy-Item "$src\.env" "$dest\.env" -Force

# 4. Copy frontend dist
Write-Host "Copy frontend dist..." -ForegroundColor Yellow
if (Test-Path "$dest\dist") { Remove-Item "$dest\dist\*" -Recurse -Force }
New-Item -ItemType Directory -Path "$dest\dist" -Force | Out-Null
Copy-Item "$src\dist\*" "$dest\dist\" -Recurse -Force

Write-Host "=== Deploy selesai ===" -ForegroundColor Green

# 5. Install service jika belum
if (-not $svc) {
    Write-Host "Install service..." -ForegroundColor Yellow
    & "$dest\server.exe" install
}

# 6. Start service
Write-Host "Start service..." -ForegroundColor Yellow
sc.exe start ThermaltrueServer
Start-Sleep -Seconds 3

# 7. Cek status
$svc2 = Get-Service -Name "ThermaltrueServer" -ErrorAction SilentlyContinue
if ($svc2 -and $svc2.Status -eq "Running") {
    Write-Host "=== SERVICE RUNNING ===" -ForegroundColor Green
} else {
    Write-Host "=== SERVICE START FAILED ===" -ForegroundColor Red
    Write-Host "Cek log: Get-Content `"`$env:ProgramData\Thermaltrue\logs\server.log`" -Tail 30"
}

# 8. Cek health
try {
    $health = Invoke-WebRequest -Uri "http://localhost:3000/api/health" -UseBasicParsing -TimeoutSec 5
    Write-Host "Health check: $($health.Content)" -ForegroundColor Green
} catch {
    Write-Host "Health check failed: $_" -ForegroundColor Red
}

# 9. Cek admin password
$logPath = "$env:ProgramData\Thermaltrue\logs\server.log"
if (Test-Path $logPath) {
    $pw = Select-String -Path $logPath -Pattern "DEFAULT ADMIN PASSWORD|password"
    if ($pw) {
        Write-Host "Admin credential:" -ForegroundColor Cyan
        $pw.Line | ForEach-Object { Write-Host "  $_" }
    }
}

Write-Host ""
Write-Host "Akses: http://localhost:3000" -ForegroundColor Cyan
Write-Host "Login: admin / (lihat password di atas)" -ForegroundColor Cyan
