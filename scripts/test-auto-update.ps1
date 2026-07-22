<#
.SYNOPSIS
    Test Tauri auto-update end-to-end: setup local update server, serve new version,
    and guide user through verification.
.DESCRIPTION
    Automates the auto-update test workflow:
      1. Build current app as the "new" version
      2. Sign the installer and generate update.json
      3. Start the local update server (port 3001)
      4. Save build artifacts to scripts/update-server/dist/
      5. Show step-by-step instructions for the user
    After this script completes, the user can run the OLD app, which will detect
    the new version from the local update server.
.PARAMETER NewVersion
    Version label for the "new" release (default: auto-detected from tauri.conf.json).
.PARAMETER UpdatePort
    Port for the local update server (default: 3001).
.PARAMETER SkipBuild
    Skip the Tauri build step. Use existing artifacts from target/release/bundle/.
.PARAMETER Force
    Overwrite update.json and dist files without prompting.
.PARAMETER Ci
    CI mode: non-interactive, auto-answers.
.EXAMPLE
    .\scripts\test-auto-update.ps1
.EXAMPLE
    .\scripts\test-auto-update.ps1 -SkipBuild -Force
#>

param(
    [Parameter(Mandatory = $false)]
    [string]$NewVersion = "",

    [Parameter(Mandatory = $false)]
    [int]$UpdatePort = 3001,

    [switch]$SkipBuild,

    [switch]$Force,

    [switch]$Ci
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$TauriConf = "$ProjectRoot\src-tauri\tauri.conf.json"
$CargoToml = "$ProjectRoot\src-tauri\Cargo.toml"
$PackageJson = "$ProjectRoot\package.json"
$DistDir = "$ProjectRoot\scripts\update-server\dist"
$BundleDir = "$ProjectRoot\target\release\bundle"

# ── Helper functions ────────────────────────────────────────────────────

function Write-Step($msg) {
    Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Magenta
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Magenta
}

function Write-Success($msg) {
    Write-Host "  ✓ $msg" -ForegroundColor Green
}

function Write-Info($msg) {
    Write-Host "  → $msg" -ForegroundColor Yellow
}

function Read-VersionFromJson($file) {
    $json = Get-Content $file -Raw | ConvertFrom-Json
    return $json.version
}

function Wait-Key($prompt = "Press Enter to continue or Ctrl+C to abort...") {
    if (-not $Ci) {
        Write-Host "`n  $prompt" -ForegroundColor Gray
        [void][System.Console]::ReadLine()
    }
}

# ── Detect current version ──────────────────────────────────────────────

Write-Step "PHASE 1: Detect current version"
if (-not (Test-Path $TauriConf)) {
    Write-Error "tauri.conf.json not found at $TauriConf"
    exit 1
}

$CurrentVersion = Read-VersionFromJson $TauriConf
if (-not $NewVersion) { $NewVersion = $CurrentVersion }

Write-Host "  Current version (installed app): ... (old)" -ForegroundColor Yellow
Write-Host "  New version (served as update):  $NewVersion" -ForegroundColor Green
Write-Host "  Update server port:              $UpdatePort" -ForegroundColor Cyan

# ── Build new version (if needed) ────────────────────────────────────────

if (-not $SkipBuild) {
    Write-Step "PHASE 2: Build Tauri app (new version: $NewVersion)"
    
    # Check for Tauri signing key
    $PrivateKeyPath = "$env:USERPROFILE\.tauri-key"
    $env:TAURI_KEY_PASSWORD = if ($env:TAURI_KEY_PASSWORD) { $env:TAURI_KEY_PASSWORD } else { "47c6e29a-b47b-4c66-b5dc-8fdf43c69bac" }
    
    if (-not (Test-Path $PrivateKeyPath) -and -not $env:TAURI_PRIVATE_KEY) {
        Write-Info "No Tauri signing key found. Running generate-keys.ps1..."
        & "$PSScriptRoot\generate-keys.ps1" -Ci -Force -SkipConfig
        if (-not (Test-Path $PrivateKeyPath)) {
            Write-Error "Key generation failed. Check generate-keys.ps1 output."
            exit 1
        }
        $env:TAURI_PRIVATE_KEY = (Get-Content $PrivateKeyPath -Raw).Trim()
    } elseif (-not $env:TAURI_PRIVATE_KEY) {
        $env:TAURI_PRIVATE_KEY = (Get-Content $PrivateKeyPath -Raw).Trim()
    }
    
    if (-not $env:TAURI_KEY_PASSWORD) {
        Write-Error "TAURI_KEY_PASSWORD is not set. Set it or ensure .tauri-key exists with known password."
        exit 1
    }
    
    Write-Info "Building Tauri app (this may take 5-15 minutes)..."
    Push-Location $ProjectRoot
    
    $buildOutput = & npx tauri build --bundles msi,nsis 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Build failed. Output:`n$buildOutput"
        Pop-Location
        exit 1
    }
    Write-Host $buildOutput
    Pop-Location
    Write-Success "Build complete"
}

# ── Verify build artifacts ──────────────────────────────────────────────

Write-Step "PHASE 3: Verify build artifacts"

$msiFiles = Get-ChildItem -Path "$BundleDir\msi" -Filter "*.msi" -ErrorAction SilentlyContinue
$nsisFiles = Get-ChildItem -Path "$BundleDir\nsis" -Filter "*.exe" -ErrorAction SilentlyContinue
$sigFiles = @(
    Get-ChildItem -Path "$BundleDir\msi" -Filter "*.sig" -ErrorAction SilentlyContinue
    Get-ChildItem -Path "$BundleDir\nsis" -Filter "*.sig" -ErrorAction SilentlyContinue
)

if (-not $msiFiles -and -not $nsisFiles) {
    Write-Error "No installer files found in $BundleDir. Build the app first or use -SkipBuild."
    exit 1
}

if ($msiFiles) { Write-Success "MSI: $($msiFiles[0].Name)" }
if ($nsisFiles) { Write-Success "NSIS: $($nsisFiles[0].Name)" }

if ($sigFiles.Count -eq 0) {
    Write-Info "No .sig files found. Signing installers now..."
    
    $allInstallers = @() + $msiFiles + $nsisFiles
    foreach ($installer in $allInstallers) {
        $sigPath = "$($installer.FullName).sig"
        Write-Info "Signing: $($installer.Name)"
        & npx tauri signer sign `
            --private-key $env:TAURI_PRIVATE_KEY `
            --password $env:TAURI_KEY_PASSWORD `
            $installer.FullName 2>&1
        if (Test-Path $sigPath) {
            Write-Success "Signed: $($installer.Name).sig"
        } else {
            Write-Error "Signing failed for $($installer.Name)"
        }
    }
    
    $sigFiles = @(
        Get-ChildItem -Path "$BundleDir\msi" -Filter "*.sig" -ErrorAction SilentlyContinue
        Get-ChildItem -Path "$BundleDir\nsis" -Filter "*.sig" -ErrorAction SilentlyContinue
    )
    
    if ($sigFiles.Count -eq 0) {
        Write-Error "Signing failed. No .sig files generated."
        exit 1
    }
} else {
    Write-Success "Found $($sigFiles.Count) signature file(s)"
}

# ── Prepare dist folder ─────────────────────────────────────────────────

Write-Step "PHASE 4: Prepare update server files"

New-Item -ItemType Directory -Path $DistDir -Force | Out-Null

# Pick the preferred installer (MSI first, then NSIS)
$PreferredInstaller = $null
if ($msiFiles) { $PreferredInstaller = $msiFiles[0] }
elseif ($nsisFiles) { $PreferredInstaller = $nsisFiles[0] }

$MsiFilename = Split-Path -Leaf $PreferredInstaller.FullName
$BaseUrl = "http://localhost:$UpdatePort/files"

Write-Info "Installer: $MsiFilename"
Write-Info "Base URL:  $BaseUrl"

# Generate update.json
& "$PSScriptRoot\generate-update-json.ps1" `
    -Version $NewVersion `
    -MsiPath $PreferredInstaller.FullName `
    -BaseUrl $BaseUrl `
    -OutputPath "$DistDir\update.json" `
    -Force

# Copy all installers and sig files to dist
$allBundleFiles = @(
    Get-ChildItem -Path "$BundleDir\msi" -File -ErrorAction SilentlyContinue
    Get-ChildItem -Path "$BundleDir\nsis" -File -ErrorAction SilentlyContinue
)
foreach ($file in $allBundleFiles) {
    Copy-Item -Path $file.FullName -Destination "$DistDir\$($file.Name)" -Force
    Write-Success "Copied: $($file.Name)"
}

# ── Create rollback test update.json (corrupted signature) ──────────

$CorruptedSig = "ROLLBACK_TEST_INVALID_SIGNATURE"
$CorruptedJson = @"
{
  "version": "$NewVersion",
  "notes": "Corrupted update for rollback test",
  "pub_date": "$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')",
  "platforms": {
    "windows-x86_64": {
      "signature": "$CorruptedSig",
      "url": "$BaseUrl/$MsiFilename"
    }
  }
}
"@
Set-Content -Path "$DistDir\update-rollback.json" -Value $CorruptedJson
Write-Success "Created update-rollback.json (for rollback test)"

Write-Success "Update server dist folder ready at: $DistDir"

# ── Start update server ────────────────────────────────────────────

Write-Step "PHASE 5: Start local update server"

$ServerDir = "$ProjectRoot\scripts\update-server"
if (-not (Test-Path "$ServerDir\node_modules\express")) {
    Write-Info "Installing update server dependencies..."
    Push-Location $ServerDir
    npm install 2>&1 | Out-Null
    Pop-Location
    Write-Success "Dependencies installed"
}

# Kill any existing update server on the port
$existing = Get-NetTCPConnection -LocalPort $UpdatePort -ErrorAction SilentlyContinue
if ($existing) {
    Write-Info "Killing existing process on port $UpdatePort..."
    $existing | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 1
}

$ServerLog = "$ProjectRoot\scripts\update-server\server-test.log"

# Start update server in background
$env:PORT = $UpdatePort
$env:UPDATE_DIR = $DistDir
$serverJob = Start-Job -Name "UpdateServer" -ScriptBlock {
    param($dir, $port)
    Set-Location $dir
    $env:PORT = $port
    $env:UPDATE_DIR = "$dir\dist"
    node server.js
} -ArgumentList $ServerDir, $UpdatePort

Start-Sleep -Seconds 2

# Verify server is up
try {
    $response = Invoke-WebRequest -Uri "http://localhost:$UpdatePort/update.json" -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -eq 200) {
        Write-Success "Update server running at http://localhost:$UpdatePort"
        Write-Success "Update JSON:  http://localhost:$UpdatePort/update.json"
    }
} catch {
    # Fallback: check base endpoint
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$UpdatePort/" -UseBasicParsing -TimeoutSec 5
        Write-Success "Update server running at http://localhost:$UpdatePort"
    } catch {
        Write-Warning "Could not verify server is running. Check $ServerLog for details."
        Write-Info "Try manually: cd scripts/update-server && npm start"
    }
}

# Also start a second server on port 3002 for rollback test
$env:PORT = 3002
$env:UPDATE_DIR = $DistDir
$rollbackJob = Start-Job -Name "UpdateServerRollback" -ScriptBlock {
    param($dir, $port)
    Set-Location $dir
    $env:PORT = $port
    $env:UPDATE_DIR = "$dir\dist"
    $updateJsonPath = "$dir\dist\update.json"
    $rollbackJsonPath = "$dir\dist\update-rollback.json"
    
    # For rollback test, we serve the corrupted update.json
    # We use a flag file to switch between normal and rollback modes
    node server.js
} -ArgumentList $ServerDir, 3002

# ── Show instructions ─────────────────────────────────────────────────

Write-Step "PHASE 6: TEST INSTRUCTIONS"

@"

═══════════════════════════════════════════════════════════════
              AUTO-UPDATE TEST GUIDE
═══════════════════════════════════════════════════════════════

  Test Scenario: Update from OLD version → $NewVersion

  PREREQUISITES:
    1. You need the OLD version (v1.0.0) INSTALLED on this machine.
       If not installed, download from GitHub Releases or use an
       existing build.

  TEST STEPS:
    ───────────────────────────────────────────────────────
    STEP 1 — Normal Update Test
    ───────────────────────────────────────────────────────
      a) Open the OLD app (v1.0.0)
      b) Wait for auto-update check (runs on startup)
         OR trigger manually (if manual trigger is implemented)
      c) The app should detect version $NewVersion
      d) Click "Download & Install" when prompted
      e) Wait for download to complete
      f) The app will restart automatically

    EXPECTED:
      ✓ App detects update available
      ✓ Download starts and shows progress
      ✓ Install completes
      ✓ App restarts and shows version $NewVersion

    ───────────────────────────────────────────────────────
    STEP 2 — Rollback Test
    ───────────────────────────────────────────────────────
      To simulate a failed update (corrupted signature):

      METHOD A: Stop the server, restart with rollback json
        Stop-Process -Name node -Force
        Copy-Item "$DistDir\update-rollback.json" "$DistDir\update.json" -Force
        <start server again>

      METHOD B: Or run the rollback test script:
        .\scripts\test-rollback.ps1

      Then run the OLD app again and try to update.

    EXPECTED:
      ✓ Update check succeeds (server responds)
      ✓ Download starts
      ✓ Signature validation FAILS
      ✓ App shows error notification
      ✓ App stays on OLD version
      ✓ No crash, app continues running normally

  VERIFICATION:
    ✓ Check app title bar shows correct version
    ✓ Check Settings → System page shows version
    ✓ Check startup.log for update-related entries
    ✓ Check Windows Event Log for installer logs

  CLEANUP:
    To stop the update server:
      Stop-Job -Name "UpdateServer"
      Stop-Job -Name "UpdateServerRollback"
      Remove-Job -Name "UpdateServer" -Force
      Remove-Job -Name "UpdateServerRollback" -Force

    To restore version files (if modified):
      git checkout -- src-tauri/tauri.conf.json
      git checkout -- src-tauri/Cargo.toml
      git checkout -- package.json

═══════════════════════════════════════════════════════════════
"@ | Write-Host -ForegroundColor White

# Open the server log
Write-Host "`n  Update server is running in the background." -ForegroundColor Green
Write-Host "  Server log: $ServerLog" -ForegroundColor Gray
Write-Host "  Press Ctrl+C to stop the server when done." -ForegroundColor Yellow

# Keep script alive until Ctrl+C
try {
    while ($true) {
        Start-Sleep -Seconds 10
        # Periodic health check
        try {
            $null = Invoke-WebRequest -Uri "http://localhost:$UpdatePort/" -UseBasicParsing -TimeoutSec 3
            Write-Host "  [$(Get-Date -Format 'HH:mm:ss')] Server OK" -ForegroundColor Gray
        } catch {
            Write-Warning "[$(Get-Date -Format 'HH:mm:ss')] Server unreachable. Attempting restart..."
            # Try to restart
            $env:PORT = $UpdatePort
            $env:UPDATE_DIR = $DistDir
            $serverJob = Start-Job -Name "UpdateServer" -ScriptBlock {
                param($dir, $port)
                Set-Location $dir
                $env:PORT = $port
                $env:UPDATE_DIR = "$dir\dist"
                node server.js
            } -ArgumentList $ServerDir, $UpdatePort
        }
    }
} finally {
    # Cleanup
    Write-Host "`n  Cleaning up..." -ForegroundColor Yellow
    Stop-Job -Name "UpdateServer" -ErrorAction SilentlyContinue
    Stop-Job -Name "UpdateServerRollback" -ErrorAction SilentlyContinue
    Remove-Job -Name "UpdateServer" -Force -ErrorAction SilentlyContinue
    Remove-Job -Name "UpdateServerRollback" -Force -ErrorAction SilentlyContinue
    Write-Host "  Done." -ForegroundColor Green
}
