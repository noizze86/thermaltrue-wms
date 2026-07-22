<#
.SYNOPSIS
    Simulate a failed update (rollback test) by serving a corrupted update.json.
.DESCRIPTION
    Starts a local update server on port 3002 that serves a deliberately
    corrupted update.json (invalid signature). Use this to verify that:
      - The app detects the update availability
      - The download proceeds
      - Signature validation fails
      - The app stays on the old version (no crash)
.PARAMETER Port
    Port for the rollback test server (default: 3002).
.PARAMETER UseCorruptedSignature
    Use truly corrupted signature (default: true).
.PARAMETER UseMissingFile
    Point to a non-existent installer file (404 test).
.PARAMETER UseWrongVersion
    Point to correct file but wrong version in update.json.
.EXAMPLE
    .\scripts\test-rollback.ps1
    .\scripts\test-rollback.ps1 -Port 3003 -UseMissingFile
#>

param(
    [Parameter(Mandatory = $false)]
    [int]$Port = 3002,

    [switch]$UseCorruptedSignature,

    [switch]$UseMissingFile,

    [switch]$UseWrongVersion
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DistDir = "$ProjectRoot\scripts\update-server\dist"
$ServerDir = "$ProjectRoot\scripts\update-server"

# ── Verify dist exists ──────────────────────────────────────────────────

if (-not (Test-Path $DistDir)) {
    Write-Error "Update server dist directory not found at $DistDir.`nRun 'scripts\test-auto-update.ps1' first to build and prepare artifacts."
    exit 1
}

$msiFiles = Get-ChildItem -Path $DistDir -Filter "*.msi" -ErrorAction SilentlyContinue
$sigFiles = Get-ChildItem -Path $DistDir -Filter "*.sig" -ErrorAction SilentlyContinue

if (-not $msiFiles) {
    Write-Error "No installer files found in $DistDir. Run 'scripts\test-auto-update.ps1' first."
    exit 1
}

$InstallerFile = $msiFiles[0]
$InstallerName = $InstallerFile.Name

# ── Detect version from update.json ─────────────────────────────────────

$UpdateJsonPath = "$DistDir\update.json"
$RollbackJsonPath = "$DistDir\update-rollback-test.json"

$Version = "1.0.0"
if (Test-Path $UpdateJsonPath) {
    $existing = Get-Content $UpdateJsonPath -Raw | ConvertFrom-Json
    $Version = $existing.version
}

# ── Generate rollback update.json ───────────────────────────────────────

$PubDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$BaseUrl = "http://localhost:$Port/files"

if ($UseMissingFile) {
    # Scenario: update.json points to a non-existent installer
    $MissingFile = "Thermaltrue_$($Version)_DOES_NOT_EXIST_x64_en-US.msi"
    $Signature = "SIGNATURE_FOR_MISSING_FILE_TEST"
    
    $json = @"
{
  "version": "$Version",
  "notes": "Rollback test: missing installer file",
  "pub_date": "$PubDate",
  "platforms": {
    "windows-x86_64": {
      "signature": "$Signature",
      "url": "$BaseUrl/$MissingFile"
    }
  }
}
"@
    Write-Host "  Test scenario: Missing installer file" -ForegroundColor Yellow
    Write-Host "  URL: $BaseUrl/$MissingFile (does not exist)" -ForegroundColor Gray

} elseif ($UseWrongVersion) {
    # Scenario: update.json says higher version but the installer is the same
    $WrongVersion = "99.99.99"
    $Signature = if ($sigFiles) { (Get-Content $sigFiles[0].FullName -Raw).Trim() } else { "VALID_SIGNATURE_NONE" }
    
    $json = @"
{
  "version": "$WrongVersion",
  "notes": "Rollback test: version mismatch in binary",
  "pub_date": "$PubDate",
  "platforms": {
    "windows-x86_64": {
      "signature": "$Signature",
      "url": "$BaseUrl/$InstallerName"
    }
  }
}
"@
    Write-Host "  Test scenario: Version mismatch (JSON says $WrongVersion)" -ForegroundColor Yellow

} else {
    # Default: corrupted signature
    $CorruptedSig = "ROLLBACK_TEST_INVALID_SIGNATURE_$(Get-Random -Maximum 99999)"
    
    $json = @"
{
  "version": "$Version",
  "notes": "Rollback test: invalid signature",
  "pub_date": "$PubDate",
  "platforms": {
    "windows-x86_64": {
      "signature": "$CorruptedSig",
      "url": "$BaseUrl/$InstallerName"
    }
  }
}
"@
    Write-Host "  Test scenario: Invalid signature" -ForegroundColor Yellow
    Write-Host "  Signature: $CorruptedSig" -ForegroundColor Gray
}

Set-Content -Path $RollbackJsonPath -Value $json
Write-Host "  Rollback update.json: $RollbackJsonPath" -ForegroundColor Cyan

# ── Start server serving rollback config ─────────────────────────────────

# Kill existing process on the port
$existing = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "  Killing existing process on port $Port..." -ForegroundColor Yellow
    $existing | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 1
}

# We modify server startup to serve the rollback file as update.json
# Strategy: start the server, then periodically swap update.json
Write-Host "`n  Starting rollback test server on port $Port..." -ForegroundColor Cyan

$ServerLog = "$ProjectRoot\scripts\update-server\rollback-test.log"

$rollbackJob = Start-Job -Name "RollbackTest" -ScriptBlock {
    param($serverDir, $rollbackJson, $port, $distDir, $normalJson)
    
    Set-Location $serverDir
    $env:PORT = $port
    $env:UPDATE_DIR = $distDir
    
    # Save original update.json and replace with rollback version
    $originalJson = "$distDir\update.json"
    $backupJson = "$distDir\update.json.bak"
    
    if (Test-Path $originalJson) {
        Copy-Item -Path $originalJson -Destination $backupJson -Force
    }
    
    Copy-Item -Path $rollbackJson -Destination $originalJson -Force
    
    # Start the update server
    $server = Start-Process -FilePath "node" -ArgumentList "server.js" -NoNewWindow -PassThru -RedirectStandardOutput "$serverDir\rollback-server.log"
    
    # Wait, then restore original after 5 minutes
    Start-Sleep -Seconds 300
    
    # Restore original update.json
    if (Test-Path $backupJson) {
        Copy-Item -Path $backupJson -Destination $originalJson -Force
        Remove-Item -Path $backupJson -Force
    }
    
    $server | Wait-Process
} -ArgumentList $ServerDir, $RollbackJsonPath, $Port, $DistDir, $UpdateJsonPath

Start-Sleep -Seconds 2

# ── Verify ──────────────────────────────────────────────────────────────

try {
    $response = Invoke-WebRequest -Uri "http://localhost:$Port/update.json" -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -eq 200) {
        Write-Host "`n  ✓ Rollback test server running!" -ForegroundColor Green
        Write-Host "  URL: http://localhost:$Port/update.json" -ForegroundColor Cyan
        Write-Host "  Content: $($response.Content)" -ForegroundColor Gray
    }
} catch {
    Write-Warning "Server did not respond. Check $ServerLog for details."
}

# ── Instructions ────────────────────────────────────────────────────────

@"

═══════════════════════════════════════════════════════════════
              ROLLBACK TEST - INSTRUCTIONS
═══════════════════════════════════════════════════════════════

  The rollback test server is running at:
    http://localhost:$Port/update.json

  This server serves a CORRUPTED update.json to simulate
  a failed update scenario.

  TEST STEPS:
    ───────────────────────────────────────────────────────
    For Tauri auto-update, change the update endpoint:
    ───────────────────────────────────────────────────────

    METHOD 1: Modify tauri.conf.json temporarily
      Set plugins.updater.endpoints:
        ["http://localhost:$Port/update.json"]

    METHOD 2: Modify system hosts/DNS (not recommended)

    METHOD 3: Use browser dev tools to test the JSON endpoint:
      curl http://localhost:$Port/update.json

  EXPECTED BEHAVIOR:
    1. App checks for update
    2. Finds version $Version available
    3. Downloads the installer
    4. Signature validation FAILS (corrupted)
    5. ✓ App shows error notification
    6. ✓ App stays on current version
    7. ✓ App continues running normally
    8. ✓ No crash or data loss

  Press Ctrl+C to stop the rollback test server.
═══════════════════════════════════════════════════════════════
"@ | Write-Host -ForegroundColor White

# Keep alive
try {
    while ($true) { Start-Sleep -Seconds 10 }
} finally {
    Write-Host "`n  Cleaning up..." -ForegroundColor Yellow
    Stop-Job -Name "RollbackTest" -ErrorAction SilentlyContinue
    Remove-Job -Name "RollbackTest" -Force -ErrorAction SilentlyContinue
    
    # Restore original update.json
    $backupJson = "$DistDir\update.json.bak"
    if (Test-Path $backupJson) {
        Copy-Item -Path $backupJson -Destination "$DistDir\update.json" -Force
        Remove-Item -Path $backupJson -Force
        Write-Host "  Restored original update.json" -ForegroundColor Green
    }
    Write-Host "  Done." -ForegroundColor Green
}
