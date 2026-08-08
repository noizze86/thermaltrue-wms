Write-Host "=== Thermaltrue Deploy ===" -ForegroundColor Cyan

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    Write-Host "PERLU ADMIN: menjalankan ulang dengan elevated..." -ForegroundColor Yellow
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Wait
    exit 0
}

Write-Host "[1/4] Building release binary..." -ForegroundColor Yellow
$result = & cargo build --release -p server 2>&1
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
    $result | ForEach-Object { Write-Host $_ -ForegroundColor Red }
    exit 1
}
Write-Host "  OK" -ForegroundColor Green

$src = "C:\test wms\thermaltrue\target\release\server.exe"
$dst = "C:\Program Files\Thermaltrue\server.exe"

Write-Host "[2/4] Copying new binary..." -ForegroundColor Yellow
Copy-Item $src "$dst.new" -Force
Write-Host "  OK" -ForegroundColor Green

# NOTE: .env TIDAK IKUT disalin. JWT_SECRET & config produksi dikelola
# langsung di "C:\Program Files\Thermaltrue\.env" — menimpa dari repo akan
# mereset JWT_SECRET (semua sesi logout) dan bisa menimpa kredensial.

Write-Host "[3/4] Copying frontend dist..." -ForegroundColor Yellow
$distSrc = "C:\test wms\thermaltrue\dist"
if (Test-Path $distSrc) {
    $distDst = "C:\Program Files\Thermaltrue\dist"
    if (Test-Path "$distDst.old") { Remove-Item "$distDst.old" -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path $distDst) { Rename-Item $distDst "$distDst.old" -Force }
    Copy-Item $distSrc $distDst -Recurse -Force
    Write-Host "  OK"
} else {
    Write-Host "  dist/ tidak ada, dilewati" -ForegroundColor Yellow
}

Write-Host "[4/4] Swapping files + restarting service..." -ForegroundColor Yellow
Remove-Item "$dst.old" -Force -ErrorAction SilentlyContinue
if (Test-Path "$dst.old") {
    Write-Host "  server.exe.old terkunci, pakai nama cadangan" -ForegroundColor Yellow
    Rename-Item $dst "$dst.old-$(Get-Date -Format yyyyMMddHHmmss)" -Force
} else {
    Rename-Item $dst "$dst.old" -Force
}
Rename-Item "$dst.new" $dst -Force

sc.exe stop ThermaltrueServer | Out-Null
$stopped = $false
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 2
    $st = & sc.exe query ThermaltrueServer | Select-String 'STATE'
    if ($st -match 'STOPPED') { $stopped = $true; break }
}
if (-not $stopped) {
    Write-Host "  stop hang, force-kill PID..." -ForegroundColor Yellow
    $pidLine = ((& sc.exe queryex ThermaltrueServer | Select-String 'PID') -split ':' | Select-Object -Last 1).Trim()
    Stop-Process -Id $pidLine -Force
    Start-Sleep -Seconds 5
}
& sc.exe start ThermaltrueServer | Out-Null
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 2
    $st2 = & sc.exe query ThermaltrueServer | Select-String 'STATE'
    if ($st2 -match 'RUNNING') {
        Write-Host "  Service restarted" -ForegroundColor Green
        break
    }
}
if (-not ($st2 -match 'RUNNING')) { Write-Host "  Service start failed, reboot needed" -ForegroundColor Yellow }

Write-Host "=== Deploy complete! ===" -ForegroundColor Cyan
Get-ChildItem "C:\Program Files\Thermaltrue\server.exe*" | Select-Object Name, Length, LastWriteTime