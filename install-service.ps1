# Thermaltrue -- Install Windows Service (auto-start on boot)
# Jalankan dengan: PowerShell -ExecutionPolicy Bypass -File install-service.ps1

# Auto-elevate jika tidak sebagai Administrator
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Meminta hak Administrator..." -ForegroundColor Yellow
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "PowerShell.exe"
    $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    $psi.Verb = "RunAs"
    [System.Diagnostics.Process]::Start($psi) | Out-Null
    exit
}

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallDir = "C:\Program Files\Thermaltrue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Thermaltrue -- Install Windows Service " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Buat folder instalasi
Write-Host "[1/4] Creating $InstallDir..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Write-Host "  OK" -ForegroundColor Green

# 2. Copy server.exe + .env
Write-Host "[2/4] Copying files..." -ForegroundColor Yellow
Copy-Item (Join-Path $ScriptDir "target\release\server.exe") (Join-Path $InstallDir "server.exe") -Force
if (Test-Path (Join-Path $ScriptDir ".env")) {
    Copy-Item (Join-Path $ScriptDir ".env") (Join-Path $InstallDir ".env") -Force
    Write-Host "  .env copied" -ForegroundColor Green
} else {
    Write-Host "  WARNING: .env not found" -ForegroundColor Yellow
}
Write-Host "  server.exe copied" -ForegroundColor Green

# 3. Install Windows Service
Write-Host "[3/4] Installing service..." -ForegroundColor Yellow
Set-Location $InstallDir
& ".\server.exe" install
if ($LASTEXITCODE -ne 0) { throw "Install failed" }

# 4. Start service
Write-Host "[4/4] Starting service..." -ForegroundColor Yellow
& ".\server.exe" start
if ($LASTEXITCODE -ne 0) { throw "Start failed" }

# 5. Verifikasi
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Installation Complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
$status = & ".\server.exe" status
Write-Host "$status" -ForegroundColor Green
Write-Host ""

$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*' } | Select-Object -First 1).IPAddress
if ($ip) {
    Write-Host "Akses dari komputer lain:" -ForegroundColor Cyan
    Write-Host "  http://$($ip):3000" -ForegroundColor Green
}
Write-Host ""
Write-Host "Service akan auto-start saat Windows boot." -ForegroundColor Cyan

Set-Location $ScriptDir

pause
