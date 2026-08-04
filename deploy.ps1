Write-Host "=== Thermaltrue Deploy ===" -ForegroundColor Cyan

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
$envSrc = "C:\test wms\thermaltrue\.env"
$envDst = "C:\Program Files\Thermaltrue\.env"

Write-Host "[2/4] Copying new binary..." -ForegroundColor Yellow
Copy-Item $src "$dst.new" -Force
Write-Host "  OK" -ForegroundColor Green

Write-Host "[3/5] Copying .env..." -ForegroundColor Yellow
Copy-Item $envSrc $envDst -Force
Write-Host "  OK" -ForegroundColor Green

Write-Host "[4/5] Swapping files..." -ForegroundColor Yellow
Remove-Item "$dst.old" -Force -ErrorAction SilentlyContinue
Rename-Item $dst "$dst.old" -Force
Rename-Item "$dst.new" $dst -Force
Write-Host "  OK" -ForegroundColor Green

Write-Host "[5/5] Restarting service..." -ForegroundColor Yellow
Restart-Service -Name ThermaltrueServer -Force -ErrorAction SilentlyContinue
if ($?) { Write-Host "  Service restarted" -ForegroundColor Green }
else { Write-Host "  Service restart failed, reboot needed" -ForegroundColor Yellow }

Write-Host "=== Deploy complete! ===" -ForegroundColor Cyan
Get-ChildItem "C:\Program Files\Thermaltrue\server.exe*" | Select-Object Name, Length, LastWriteTime
