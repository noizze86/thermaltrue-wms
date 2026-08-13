param(
    [string]$ServerUrl = "",
    [string]$ConfigFile = "$PSScriptRoot\..\src-tauri\tauri.conf.json",
    [string]$ClientConfigFile = "$PSScriptRoot\..\src-tauri\tauri.conf.client.json"
)

$ErrorActionPreference = "Stop"
$rootDir = Resolve-Path "$PSScriptRoot\.."
$configBak = "$ConfigFile.bak"

Write-Host "--- Build Tauri Desktop Client ---"
if ($ServerUrl) {
    Write-Host "Server URL: $ServerUrl"
} else {
    Write-Host "Server URL: UNIVERSAL (auto-discover via subnet scan + connect page)"
}
Write-Host ""

# 1. Backup original config
if (Test-Path $ConfigFile) {
    Copy-Item -Path $ConfigFile -Destination $configBak -Force
    Write-Host "[1/4] Original config backed up -> $configBak"
} else {
    Write-Error "Config not found: $ConfigFile"
    exit 1
}

# 2. Prepare client config
try {
    $clientConfig = Get-Content $ClientConfigFile -Raw
    if ($ServerUrl) {
        if ($ServerUrl -match "^https?://") {
            $finalUrl = $ServerUrl
        } else {
            $finalUrl = "http://${ServerUrl}:3000"
        }
        if ($clientConfig -match '\{\{SERVER_IP\}\}') {
            # Template lama berbasis placeholder IP
            $clientConfig = $clientConfig.Replace('http://{{SERVER_IP}}:3000', $finalUrl)
        } else {
            # Template universal berbasis shell (tauri://localhost) -> bake URL server
            $clientConfig = $clientConfig.Replace('"url": "tauri://localhost"', '"url": "' + $finalUrl + '"')
        }
    }
    Set-Content -Path $ConfigFile -Value $clientConfig -NoNewline
    if ($ServerUrl) {
        Write-Host "[2/4] Client config applied with server: $finalUrl"
    } else {
        Write-Host "[2/4] Client config universal ('tauri://localhost') - auto-discover server"
    }
} catch {
    Write-Error "Failed to prepare client config: $_"
    if (Test-Path $configBak) { Copy-Item $configBak $ConfigFile -Force }
    exit 1
}

# 3. Build Tauri MSI
Write-Host "[3/4] Building Tauri MSI (this may take a while)..."
Push-Location $rootDir
try {
    npx tauri build --bundles msi 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri build failed with exit code $LASTEXITCODE"
    }
    Write-Host "[3/4] Build completed successfully"
} catch {
    Write-Error "Build failed: $_"
    Pop-Location
    if (Test-Path $configBak) { Copy-Item $configBak $ConfigFile -Force }
    exit 1
}
Pop-Location

# 4. Restore original config
if (Test-Path $configBak) {
    Copy-Item $configBak $ConfigFile -Force
    Remove-Item $configBak -Force
    Write-Host "[4/4] Original config restored"
}

# 5. Locate output MSI
$msi = Get-ChildItem -Path "$rootDir\target\release\bundle\msi" -Filter "*.msi" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($msi) {
    Write-Host ""
    Write-Host "OUTPUT: $($msi.FullName)"
    Write-Host "  Size: $('{0:N0}' -f ($msi.Length / 1KB)) KB"
    Write-Host "  Date: $($msi.LastWriteTime)"
} else {
    Write-Warning "MSI not found. Check src-tauri/target/release/bundle/msi/"
}

Write-Host ""
Write-Host "Done!"
