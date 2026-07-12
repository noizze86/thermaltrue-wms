# Install Thermaltrue WMS API Server as a Windows Service
# Run as Administrator

$serviceName = "ThermaltrueServer"
$binaryPath = Join-Path $PSScriptRoot "target\release\server.exe"

if (-not (Test-Path $binaryPath)) {
    Write-Error "server.exe not found at $binaryPath. Build first: cargo build -p server --release"
    exit 1
}

if (-not (Test-Path (Join-Path $PSScriptRoot ".env"))) {
    Write-Warning "No .env file found. Create one with DATABASE_URL=postgres://user:pass@host/dbname"
}

# Install service
& $binaryPath install

Write-Host "Starting service..."
& $binaryPath start

Write-Host "Status:"
& $binaryPath status
