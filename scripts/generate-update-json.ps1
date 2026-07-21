<#
.SYNOPSIS
    Generate update.json for Tauri auto-updater.
.DESCRIPTION
    Reads the .msi and .sig files from a Tauri build and generates
    update.json with the correct signature, version, and download URL.
    Also copies installer files to the update server's dist folder.
.PARAMETER Version
    Version string (e.g. "1.0.1"). Required.
.PARAMETER MsiPath
    Path to the .msi file. If omitted, auto-detects from target/release/bundle/msi/.
.PARAMETER BaseUrl
    Base URL for downloading installer files. Default: "http://localhost:3001/files".
.PARAMETER OutputPath
    Where to write update.json. Default: "scripts/update-server/dist/update.json".
.PARAMETER Notes
    Custom release notes. Default: "See release notes on GitHub".
.PARAMETER Force
    Overwrite existing update.json without prompting.
.PARAMETER SkipCopy
    Skip copying .msi and .sig files to dist folder.
.EXAMPLE
    .\scripts\generate-update-json.ps1 -Version "1.0.1"
.EXAMPLE
    .\scripts\generate-update-json.ps1 -Version "1.0.1" -MsiPath "target/release/bundle/msi/Thermaltrue_1.0.1_x64_en-US.msi" -BaseUrl "https://example.com/files"
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [Parameter(Mandatory = $false)]
    [string]$MsiPath = "",

    [Parameter(Mandatory = $false)]
    [string]$BaseUrl = "http://localhost:3001/files",

    [Parameter(Mandatory = $false)]
    [string]$OutputPath = "scripts/update-server/dist/update.json",

    [Parameter(Mandatory = $false)]
    [string]$Notes = "See release notes on GitHub",

    [switch]$Force,

    [switch]$SkipCopy
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

# ── Auto-detect MSI ──────────────────────────────────────────────────────

if (-not $MsiPath) {
    $msiDir = "$ProjectRoot\target\release\bundle\msi"
    $found = Get-ChildItem -Path $msiDir -Filter "*.msi" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
    if (-not $found) {
        Write-Error "No .msi files found in $msiDir. Build the Tauri app first or specify -MsiPath."
        exit 1
    }
    $MsiPath = $found[0].FullName
    Write-Host "Auto-detected: $MsiPath" -ForegroundColor Cyan
} else {
    $MsiPath = if ([System.IO.Path]::IsPathRooted($MsiPath)) { $MsiPath } else { Join-Path $ProjectRoot $MsiPath }
}

if (-not (Test-Path $MsiPath)) {
    Write-Error "MSI file not found: $MsiPath"
    exit 1
}

# ── Find .sig file ───────────────────────────────────────────────────────

$SigPath = "$MsiPath.sig"
if (-not (Test-Path $SigPath)) {
    Write-Error "Signature file not found: $SigPath`nMake sure TAURI_PRIVATE_KEY and TAURI_KEY_PASSWORD are set during build."
    exit 1
}

# ── Read signature ───────────────────────────────────────────────────────

$Signature = (Get-Content $SigPath -Raw).Trim()
if (-not $Signature) {
    Write-Error "Signature file is empty: $SigPath"
    exit 1
}

# ── Prepare output directory ─────────────────────────────────────────────

$OutputFull = if ([System.IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $ProjectRoot $OutputPath }
$OutputDir = Split-Path -Parent $OutputFull
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

# ── Check existing update.json ───────────────────────────────────────────

if ((Test-Path $OutputFull) -and -not $Force) {
    $answer = Read-Host "update.json already exists at $OutputFull. Overwrite? (y/N)"
    if ($answer -ne "y" -and $answer -ne "Y") {
        Write-Host "Aborted." -ForegroundColor Yellow
        exit 0
    }
}

# ── Generate update.json ─────────────────────────────────────────────────

$MsiFilename = Split-Path -Leaf $MsiPath
$PubDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$updateJson = @"
{
  "version": "$Version",
  "notes": "$Notes",
  "pub_date": "$PubDate",
  "platforms": {
    "windows-x86_64": {
      "signature": "$Signature",
      "url": "$BaseUrl/$MsiFilename"
    }
  }
}
"@

Set-Content -Path $OutputFull -Value $updateJson
Write-Host "update.json generated: $OutputFull" -ForegroundColor Green

# ── Copy installer files to dist ─────────────────────────────────────────

if (-not $SkipCopy) {
    $DistDir = $OutputDir

    $msiDest = Join-Path $DistDir $MsiFilename
    Copy-Item -Path $MsiPath -Destination $msiDest -Force
    Write-Host "Copied: $MsiFilename → $DistDir" -ForegroundColor Cyan

    $sigFilename = "$MsiFilename.sig"
    $sigDest = Join-Path $DistDir $sigFilename
    Copy-Item -Path $SigPath -Destination $sigDest -Force
    Write-Host "Copied: $sigFilename → $DistDir" -ForegroundColor Cyan

    # Also check for NSIS installer
    $nsisDir = Split-Path -Parent (Split-Path -Parent $MsiPath)
    $nsisDir = Join-Path $nsisDir "nsis"
    if (Test-Path $nsisDir) {
        $nsisFiles = Get-ChildItem -Path $nsisDir -Filter "*.exe" -ErrorAction SilentlyContinue
        foreach ($nf in $nsisFiles) {
            $dest = Join-Path $DistDir $nf.Name
            Copy-Item -Path $nf.FullName -Destination $dest -Force
            Write-Host "Copied: $($nf.Name) → $DistDir" -ForegroundColor Cyan
        }
    }
}

# ── Summary ──────────────────────────────────────────────────────────────

Write-Host "`n=== SUMMARY ===" -ForegroundColor Magenta
Write-Host "  Version:    $Version"
Write-Host "  update.json: $OutputFull"
Write-Host "  Base URL:   $BaseUrl"
Write-Host "  File:       $BaseUrl/$MsiFilename"
Write-Host "`nStart the update server:" -ForegroundColor Yellow
Write-Host "  cd scripts/update-server && npm install && node server.js" -ForegroundColor White
Write-Host "`nTest locally:" -ForegroundColor Yellow
Write-Host "  curl http://localhost:3001/update.json" -ForegroundColor White
Write-Host "`nDone." -ForegroundColor Green
