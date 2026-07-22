<#
.SYNOPSIS
    End-to-end auto-update test: builds old version, installs, builds new version,
    serves update, and guides through verification.
.DESCRIPTION
    This script automates the ENTIRE auto-update test workflow:
    1. Backup tauri.conf.json, Cargo.toml, package.json
    2. Build OLD version (v1.0.0) with localhost endpoint
    3. Install the MSI silently
    4. Build NEW version (v1.0.2) with localhost endpoint
    5. Set up update server serving v1.0.2 artifacts
    6. Launch old app and guide through update test
    7. Run rollback test
    8. Restore original config files
#>

param(
    [string]$OldVersion = "1.0.0",
    [string]$NewVersion = "1.0.2",
    [int]$UpdatePort = 3001,
    [switch]$SkipBuildOld,
    [switch]$SkipBuildNew,
    [switch]$SkipInstall,
    [switch]$Ci
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BackupDir = "$ProjectRoot\.update-test-backup"

$FilesToModify = @(
    "$ProjectRoot\src-tauri\tauri.conf.json",
    "$ProjectRoot\src-tauri\Cargo.toml",
    "$ProjectRoot\package.json"
)

function Write-Step($msg) { Write-Host "`n`n╔══════════════════════════════════════════════════╗" -ForegroundColor Magenta; Write-Host "║ $msg" -ForegroundColor Cyan; Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Magenta }
function Write-Ok($msg) { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  ⚠ $msg" -ForegroundColor Yellow }
function Write-Info($msg) { Write-Host "  → $msg" -ForegroundColor Gray }
function Set-VersionInJson($file, $version) { (Get-Content $file -Raw | ConvertFrom-Json).version = $version; (Get-Content $file -Raw | ConvertFrom-Json) | ConvertTo-Json -Depth 10 | Set-Content $file }
function Set-VersionInToml($file, $version) { (Get-Content $file) -replace '^version = ".*"', "version = `"$version`"" | Set-Content $file }
function Set-EndpointInConf($file, $endpoint) { $json = Get-Content $file -Raw | ConvertFrom-Json; if (-not $json.plugins) { $json | Add-Member -NotePropertyName "plugins" -NotePropertyValue @{ updater = @{ endpoints = @($endpoint) } } } else { $json.plugins.updater.endpoints = @($endpoint) }; $json | ConvertTo-Json -Depth 10 | Set-Content $file }

# ── Step 0: Backup ─────────────────────────────────────────────────────

Write-Step "STEP 0: Backup current config"
New-Item -ItemType Directory -Path $BackupDir -Force -ErrorAction SilentlyContinue | Out-Null
foreach ($f in $FilesToModify) {
    $name = Split-Path -Leaf $f
    Copy-Item -Path $f -Destination "$BackupDir\$name.bak" -Force
    Write-Ok "Backed up: $name"
}

function Restore-Backup {
    Write-Host "`n  Restoring original config..." -ForegroundColor Yellow
    foreach ($f in $FilesToModify) {
        $name = Split-Path -Leaf $f
        $bak = "$BackupDir\$name.bak"
        if (Test-Path $bak) { Copy-Item -Path $bak -Destination $f -Force }
    }
    Write-Ok "Config restored"
}

# Register cleanup on exit
$exitHandler = {
    param()
    if (Test-Path $BackupDir) {
        Restore-Backup
        Remove-Item -Path $BackupDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action $exitHandler

# ── Step 1: Build OLD version (v1.0.0) ──────────────────────────────

if (-not $SkipBuildOld) {
    Write-Step "STEP 1: Build OLD version v$OldVersion with local endpoint"
    
    # Modify to old version
    Set-VersionInToml "$ProjectRoot\src-tauri\Cargo.toml" $OldVersion
    $json = Get-Content "$ProjectRoot\src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json
    $json.version = $OldVersion
    $json.plugins.updater.endpoints = @("http://localhost:$UpdatePort/update.json")
    $json | ConvertTo-Json -Depth 10 | Set-Content "$ProjectRoot\src-tauri\tauri.conf.json"
    
    $packageJson = Get-Content "$ProjectRoot\package.json" -Raw | ConvertFrom-Json
    $packageJson.version = $OldVersion
    $packageJson | ConvertTo-Json -Depth 10 | Set-Content "$ProjectRoot\package.json"
    
    Write-Ok "Config set to v$OldVersion with localhost endpoint"
    
    # Set signing env
    $env:TAURI_PRIVATE_KEY = (Get-Content "$env:USERPROFILE\.tauri-key" -Raw).Trim()
    if (-not $env:TAURI_KEY_PASSWORD) { $env:TAURI_KEY_PASSWORD = "47c6e29a-b47b-4c66-b5dc-8fdf43c69bac" }
    
    Write-Info "Building OLD version v$OldVersion... (this takes ~5-10 min)"
    Push-Location $ProjectRoot
    $buildOut = & npx tauri build --bundles msi 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "Build failed (may have warnings). Output:"
        Write-Host $buildOut -ForegroundColor Gray
        Restore-Backup
        exit 1
    }
    Pop-Location
    Write-Ok "OLD version v$OldVersion built successfully"
} else {
    Write-Step "STEP 1: SKIP (using existing build)"
}

# ── Step 2: Install OLD version ─────────────────────────────────────

if (-not $SkipInstall) {
    Write-Step "STEP 2: Install OLD version v$OldVersion"
    
    $msiFile = Get-ChildItem -Path "$ProjectRoot\target\release\bundle\msi" -Filter "*.msi" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $msiFile) {
        Write-Warn "No MSI found. Trying target/release/bundle/msi/..."
        $msiFile = Get-ChildItem -Path "$ProjectRoot\target\release\bundle\msi" -Recurse -Filter "*.msi" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    }
    
    if (-not $msiFile) {
        Write-Warn "No MSI file found. Skipping install."
        Write-Warn "Install manually: run MSI from target/release/bundle/msi/"
    } else {
        Write-Info "Installing: $($msiFile.FullName)"
        
        # Check if already installed
        $existing = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "*Thermaltrue*" }
        
        if ($existing) {
            Write-Info "Previous version found: v$($existing.DisplayVersion). Uninstalling..."
            $productCode = (Get-WmiObject -Class Win32_Product | Where-Object { $_.Name -like "*Thermaltrue*" }).IdentifyingNumber
            if ($productCode) {
                msiexec /x $productCode /quiet /norestart
                Start-Sleep -Seconds 3
                Write-Ok "Previous version uninstalled"
            }
        }
        
        # Install new version
        $proc = Start-Process msiexec -ArgumentList "/i `"$($msiFile.FullName)`" /quiet /norestart" -Wait -PassThru -NoNewWindow
        if ($proc.ExitCode -eq 0 -or $proc.ExitCode -eq 3010) {
            Write-Ok "MSI installed successfully (exit code: $($proc.ExitCode))"
        } else {
            Write-Warn "MSI install returned exit code: $($proc.ExitCode). May need manual install."
        }
    }
} else {
    Write-Step "STEP 2: SKIP install"
}

# ── Step 3: Build NEW version (v1.0.2) ─────────────────────────────

if (-not $SkipBuildNew) {
    Write-Step "STEP 3: Build NEW version v$NewVersion"
    
    # Modify to new version
    Set-VersionInToml "$ProjectRoot\src-tauri\Cargo.toml" $NewVersion
    $json = Get-Content "$ProjectRoot\src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json
    $json.version = $NewVersion
    $json.plugins.updater.endpoints = @("http://localhost:$UpdatePort/update.json")
    $json | ConvertTo-Json -Depth 10 | Set-Content "$ProjectRoot\src-tauri\tauri.conf.json"
    
    $packageJson = Get-Content "$ProjectRoot\package.json" -Raw | ConvertFrom-Json
    $packageJson.version = $NewVersion
    $packageJson | ConvertTo-Json -Depth 10 | Set-Content "$ProjectRoot\package.json"
    
    Write-Ok "Config set to v$NewVersion"
    
    # Incremental build (should be faster since only version changed)
    Write-Info "Building NEW version v$NewVersion... (incremental, ~3-5 min)"
    Push-Location $ProjectRoot
    $buildOut = & npx tauri build --bundles msi,nsis 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "Build failed. Output:"
        Write-Host $buildOut -ForegroundColor Gray
        Restore-Backup
        exit 1
    }
    Pop-Location
    Write-Ok "NEW version v$NewVersion built successfully"
} else {
    Write-Step "STEP 3: SKIP (using existing build)"
}

# ── Step 4: Setup update server ────────────────────────────────────

Write-Step "STEP 4: Setup update server"

$DistDir = "$ProjectRoot\scripts\update-server\dist"
New-Item -ItemType Directory -Path $DistDir -Force -ErrorAction SilentlyContinue | Out-Null

# Copy new version artifacts
$allFiles = @(
    Get-ChildItem -Path "$ProjectRoot\target\release\bundle\msi" -File -ErrorAction SilentlyContinue
    Get-ChildItem -Path "$ProjectRoot\target\release\bundle\nsis" -File -ErrorAction SilentlyContinue
)
foreach ($f in $allFiles) {
    Copy-Item -Path $f.FullName -Destination "$DistDir\$($f.Name)" -Force
    Write-Ok "Copied: $($f.Name)"
}

# Generate update.json
$msiFile = $allFiles | Where-Object { $_.Extension -eq ".msi" } | Select-Object -First 1
if ($msiFile) {
    $msiFilename = $msiFile.Name
    $sigFile = Get-ChildItem -Path $DistDir -Filter "$msiFilename.sig" | Select-Object -First 1
    
    if (-not $sigFile) {
        Write-Warn "No .sig file found. Signing installer..."
        $env:TAURI_PRIVATE_KEY = (Get-Content "$env:USERPROFILE\.tauri-key" -Raw).Trim()
        if (-not $env:TAURI_KEY_PASSWORD) { $env:TAURI_KEY_PASSWORD = "47c6e29a-b47b-4c66-b5dc-8fdf43c69bac" }
        Push-Location $ProjectRoot
        npx tauri signer sign --private-key "$env:TAURI_PRIVATE_KEY" --password "$env:TAURI_KEY_PASSWORD" "$DistDir\$msiFilename" 2>&1 | Out-Null
        Pop-Location
        $sigFile = Get-ChildItem -Path $DistDir -Filter "$msiFilename.sig" | Select-Object -First 1
    }
    
    if ($sigFile) {
        $signature = (Get-Content $sigFile.FullName -Raw).Trim()
        $pubDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        
        $updateJson = @"
{
  "version": "$NewVersion",
  "notes": "Test update from v$OldVersion to v$NewVersion",
  "pub_date": "$pubDate",
  "platforms": {
    "windows-x86_64": {
      "signature": "$signature",
      "url": "http://localhost:$UpdatePort/files/$msiFilename"
    }
  }
}
"@
        Set-Content -Path "$DistDir\update.json" -Value $updateJson
        Write-Ok "update.json generated for v$NewVersion"
        
        # Also create corrupted rollback version
        $rollbackJson = @"
{
  "version": "$NewVersion",
  "notes": "Rollback test - corrupted signature",
  "pub_date": "$pubDate",
  "platforms": {
    "windows-x86_64": {
      "signature": "ROLLBACK_TEST_INVALID_SIGNATURE_$(Get-Random)",
      "url": "http://localhost:$UpdatePort/files/$msiFilename"
    }
  }
}
"@
        Set-Content -Path "$DistDir\update-rollback.json" -Value $rollbackJson
        Write-Ok "update-rollback.json created"
    } else {
        Write-Warn "Could not sign installer. update.json will be invalid."
    }
}

# ── Step 5: Start update server ─────────────────────────────────────

Write-Step "STEP 5: Start local update server"

$ServerDir = "$ProjectRoot\scripts\update-server"
Push-Location $ServerDir
if (-not (Test-Path "node_modules\express")) { npm install 2>&1 | Out-Null }
Pop-Location

# Kill any existing process on the port
$existing = Get-NetTCPConnection -LocalPort $UpdatePort -ErrorAction SilentlyContinue
if ($existing) { $existing | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }
Start-Sleep -Seconds 1

$env:PORT = $UpdatePort
$env:UPDATE_DIR = $DistDir
$serverJob = Start-Job -Name "UpdateServer" -ScriptBlock {
    param($dir, $port, $dist)
    Set-Location $dir
    $env:PORT = $port
    $env:UPDATE_DIR = $dist
    node server.js
} -ArgumentList $ServerDir, $UpdatePort, $DistDir

Start-Sleep -Seconds 2

# Verify server
try {
    $r = Invoke-WebRequest -Uri "http://localhost:$UpdatePort/update.json" -UseBasicParsing -TimeoutSec 5
    if ($r.StatusCode -eq 200) { Write-Ok "Update server running on port $UpdatePort" }
} catch {
    Write-Warn "Server may not be responding. Check manually."
}

# ── Step 6: Test Instructions ──────────────────────────────────────

Write-Step "STEP 6: TEST READY"

$installed = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "*Thermaltrue*" }
$installedVersion = if ($installed) { $installed.DisplayVersion } else { "NOT INSTALLED" }

@"

═══════════════════════════════════════════════════════════════
              AUTO-UPDATE E2E TEST
═══════════════════════════════════════════════════════════════

  OLD version installed: $installedVersion
  NEW version on server: $NewVersion
  Update server:         http://localhost:$UpdatePort
  Update JSON:           http://localhost:$UpdatePort/update.json

────────────────────────────────────────────────────────────
 TEST 1: NORMAL UPDATE
────────────────────────────────────────────────────────────

  STEP A: Launch the installed app
    Start Menu > Thermaltrue > Thermaltrue
    OR run: "C:\Program Files\Thermaltrue\Thermaltrue.exe"

  STEP B: The app will auto-check for updates on startup.
    If it doesn't auto-check, go to:
      Settings → Update Test → "Check for Updates"

  STEP C: When prompted, click "Download & Install"

  EXPECTED RESULTS:
    ✓ App detects version $NewVersion
    ✓ Download starts and shows progress
    ✓ Installer runs (may show UAC prompt)
    ✓ App relaunches automatically (or manually)
    ✓ Title/Settings show version $NewVersion
    ✓ Log entries in Settings → Update Test

────────────────────────────────────────────────────────────
 TEST 2: ROLLBACK (FAILED UPDATE)
────────────────────────────────────────────────────────────

  To simulate a failed update:

  1. Stop current server:
       Stop-Job -Name "UpdateServer" -ErrorAction SilentlyContinue

  2. Copy rollback update.json:
       Copy-Item "$DistDir\update-rollback.json" "$DistDir\update.json" -Force

  3. Restart server:
       Same as above

  4. In the app, go to:
       Settings → Update Test → "Simulate Rollback"

  EXPECTED RESULTS:
    ✓ App finds update
    ✓ Download starts
    ✓ Signature validation FAILS
    ✓ Error message shown
    ✓ App continues running (no crash)
    ✓ App stays on old version

────────────────────────────────────────────────────────────
 CLEANUP:
────────────────────────────────────────────────────────────
  When done testing, press Ctrl+C to stop the server
  and restore original config files.

═══════════════════════════════════════════════════════════════
"@ | Write-Host -ForegroundColor White

# Keep alive until Ctrl+C
try {
    while ($true) {
        Start-Sleep -Seconds 15
        try {
            $null = Invoke-WebRequest -Uri "http://localhost:$UpdatePort/update.json" -UseBasicParsing -TimeoutSec 3
            Write-Host "  [$(Get-Date -Format 'HH:mm:ss')] Server OK" -ForegroundColor Gray
        } catch {
            Write-Warn "Server unreachable. Attempting restart..."
            $existing = Get-NetTCPConnection -LocalPort $UpdatePort -ErrorAction SilentlyContinue
            if (-not $existing) {
                $env:PORT = $UpdatePort
                $env:UPDATE_DIR = $DistDir
                $serverJob = Start-Job -Name "UpdateServer" -ScriptBlock {
                    param($dir, $port, $dist)
                    Set-Location $dir; $env:PORT = $port; $env:UPDATE_DIR = $dist
                    node server.js
                } -ArgumentList $ServerDir, $UpdatePort, $DistDir
                Start-Sleep -Seconds 2
            }
        }
    }
} finally {
    # Cleanup
    Write-Host "`n  Cleaning up..." -ForegroundColor Yellow
    Stop-Job -Name "UpdateServer" -ErrorAction SilentlyContinue
    Remove-Job -Name "UpdateServer" -Force -ErrorAction SilentlyContinue
    Restore-Backup
    Remove-Item -Path $BackupDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  Done." -ForegroundColor Green
}
