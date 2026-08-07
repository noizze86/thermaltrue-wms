# Thermaltrue — Jalankan server agar bisa diakses dari LAN
# Jalankan dengan: PowerShell -ExecutionPolicy Bypass -File run-server.ps1

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# 1. Cari server.exe
$ServerExe = Join-Path $ScriptDir "target\release\server.exe"
if (!(Test-Path $ServerExe)) {
    Write-Host "server.exe tidak ditemukan di $ServerExe" -ForegroundColor Red
    Write-Host "Build dulu: cargo build --release -p server" -ForegroundColor Yellow
    exit 1
}

# 2. Copy .env ke folder server.exe
$EnvSrc = Join-Path $ScriptDir ".env"
$EnvDst = Join-Path $ScriptDir "target\release\.env"
if (Test-Path $EnvSrc) {
    Copy-Item $EnvSrc $EnvDst -Force
    Write-Host ".env copied to $EnvDst" -ForegroundColor Green
} else {
    Write-Host ".env tidak ditemukan di $EnvSrc" -ForegroundColor Red
    Write-Host "Buat dulu dengan copy dari .env.example" -ForegroundColor Yellow
    exit 1
}

# 3. Kill proses yang pakai port 3000
Write-Host "Checking port 3000..." -ForegroundColor Yellow
$pidOnPort = (netstat -ano | Select-String ":3000 " | ForEach-Object { $_ -split '\s+' | Select-Object -Last 1 }) -replace '\D',''
if ($pidOnPort -and $pidOnPort -ne "") {
    Write-Host "Killing process PID $pidOnPort on port 3000..." -ForegroundColor Yellow
    taskkill /PID $pidOnPort /F 2>$null
    Start-Sleep -Seconds 1
    Write-Host "  Done" -ForegroundColor Green
} else {
    Write-Host "  Port 3000 is free" -ForegroundColor Green
}

# 4. Set environment variables (redundant, karena .env sudah di-copy)
$env:APP_MODE = "production"
$env:PORT = "3000"

# 5. Jalankan server
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Thermaltrue WMS Server" -ForegroundColor Cyan
Write-Host "  Bind: 0.0.0.0:3000" -ForegroundColor Cyan
Write-Host "  Akses dari komputer lain:" -ForegroundColor Cyan
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.*' } | Select-Object -First 1).IPAddress
if ($ip) { Write-Host "  http://$($ip):3000" -ForegroundColor Cyan }
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Set-Location (Split-Path -Parent $ServerExe)
& $ServerExe
