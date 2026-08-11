# Thermaltrue - build one-file installer
# Prereqs: Inno Setup 6 (ISCC), Rust workspace, npm deps, payload files (see below)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$payload = Join-Path $PSScriptRoot "payload"
$distInstaller = Join-Path $root "dist-installer"

# 1) Build server (release)
Write-Host "==> cargo build --release -p server"
Push-Location (Join-Path $root "backend")
cargo build --release -p server
if ($LASTEXITCODE -ne 0) { throw "server build failed" }
Pop-Location

# 2) Build frontend (dist for server web UI)
Write-Host "==> npm run build (dist)"
Push-Location (Join-Path $root "src")
npm run build
if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
Pop-Location

# 3) Verify payload exists
$needs = @(
    "server.exe",
    "postgresql-18.4-1-windows-x64.exe",
    "Thermaltrue_1.0.1_x64_en-US.msi",
    "icon.ico"
)
foreach ($n in $needs) {
    $p = Join-Path $payload $n
    if (-not (Test-Path $p)) { throw "missing payload: $p - copy from target\release\{server|bundle} first" }
}

# 4) Stage latest build outputs into payload
Copy-Item (Join-Path $root "target\release\server.exe") (Join-Path $payload "server.exe") -Force
Copy-Item (Join-Path $root "target\release\bundle\msi\Thermaltrue_1.0.1_x64_en-US.msi") (Join-Path $payload "Thermaltrue_1.0.1_x64_en-US.msi") -Force
if (Test-Path (Join-Path $payload "dist")) { Remove-Item (Join-Path $payload "dist") -Recurse -Force }
Copy-Item (Join-Path $root "dist") (Join-Path $payload "dist") -Recurse -Force

# 5) Compile with ISCC
$iscc = "C:\Users\Nana Rusdiana\AppData\Local\Programs\Inno Setup 6\ISCC.exe"
if (-not (Test-Path $iscc)) { throw "ISCC not found at $iscc" }
New-Item -ItemType Directory -Path $distInstaller -Force | Out-Null
Write-Host "==> ISCC compile"
& $iscc (Join-Path $PSScriptRoot "thermaltrue-server.iss")
if ($LASTEXITCODE -ne 0) { throw "ISCC failed" }

Write-Host "==> DONE"
Get-ChildItem $distInstaller | Select-Object Name,Length,LastWriteTime | Format-Table -AutoSize