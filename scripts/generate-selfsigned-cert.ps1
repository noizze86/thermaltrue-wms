<#
.SYNOPSIS
    Generate a self-signed code signing certificate for Windows. Use for testing only.
.DESCRIPTION
    Creates a self-signed Authenticode certificate, exports as PFX, and outputs
    base64-encoded value + password for GitHub Secrets (WINDOWS_CERTIFICATE and
    WINDOWS_CERTIFICATE_PASSWORD).
.PARAMETER Password
    Password for the PFX file. Auto-generated if not provided in CI mode.
.PARAMETER Subject
    Subject name for the certificate (default: "CN=ThermalTrue WMS Development").
.PARAMETER Force
    Overwrite existing outputs without prompting.
.PARAMETER Ci
    Skip interactive prompts (non-interactive mode).
.PARAMETER OutputDir
    Directory to save the PFX file (default: ./certificate).
.EXAMPLE
    .\scripts\generate-selfsigned-cert.ps1
.EXAMPLE
    .\scripts\generate-selfsigned-cert.ps1 -Ci
#>

param(
    [Parameter(Mandatory = $false)]
    [string]$Password = "",

    [Parameter(Mandatory = $false)]
    [string]$Subject = "CN=ThermalTrue WMS Development",

    [switch]$Force,

    [switch]$Ci,

    [Parameter(Mandatory = $false)]
    [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputDir) { $OutputDir = "$ProjectRoot\certificate" }

# ── Check OS ──────────────────────────────────────────────────────────

if ($PSVersionTable.PSVersion.Major -lt 5) {
    Write-Error "PowerShell 5+ required for New-SelfSignedCertificate"
    exit 1
}

# ── Check existing output ─────────────────────────────────────────────

$PfxPath = "$OutputDir\certificate.pfx"
if (Test-Path $OutputDir) {
    if ($Ci -or $Force) {
        Write-Warning "Removing existing output directory $OutputDir"
        Remove-Item -Path $OutputDir -Recurse -Force
    } else {
        $answer = Read-Host "Output directory '$OutputDir' already exists. Overwrite? (y/N)"
        if ($answer -ne "y" -and $answer -ne "Y") {
            Write-Host "Aborted." -ForegroundColor Yellow
            exit 0
        }
        Remove-Item -Path $OutputDir -Recurse -Force
    }
}

# ── Get password ──────────────────────────────────────────────────────

if (-not $Password) {
    if ($Ci) {
        $Password = [System.Guid]::NewGuid().ToString().Substring(0, 8) + "!"
        Write-Host "CI mode: auto-generated password: $Password" -ForegroundColor Cyan
    } else {
        $secure = Read-Host "Enter password for PFX file" -AsSecureString
        $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        $Password = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)
        if (-not $Password) {
            Write-Error "Password cannot be empty"
            exit 1
        }
    }
}

# ── Generate certificate ──────────────────────────────────────────────

Write-Host "Generating self-signed code signing certificate..."
Write-Host "  Subject: $Subject"

$Cert = New-SelfSignedCertificate `
    -Subject $Subject `
    -FriendlyName "ThermalTrue WMS Development Cert" `
    -NotBefore (Get-Date).AddDays(-1) `
    -NotAfter (Get-Date).AddYears(3) `
    -Type CodeSigningCert `
    -CertStoreLocation Cert:\CurrentUser\My

if (-not $Cert) {
    Write-Error "Certificate generation failed"
    exit 1
}

$Thumbprint = $Cert.Thumbprint
Write-Host "  Thumbprint: $Thumbprint" -ForegroundColor Green
Write-Host "Certificate generated and stored in Cert:\CurrentUser\My" -ForegroundColor Green

# ── Export as PFX ─────────────────────────────────────────────────────

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$SecurePassword = ConvertTo-SecureString -String $Password -Force -AsPlainText
Export-PfxCertificate -Cert $Cert -FilePath $PfxPath -Password $SecurePassword | Out-Null

if (-not (Test-Path $PfxPath)) {
    Write-Error "PFX export failed"
    exit 1
}

Write-Host "PFX exported to: $PfxPath" -ForegroundColor Green

# ── Output GitHub Secrets format ──────────────────────────────────────

$PfxBase64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($PfxPath))

Write-Host "`n" -NoNewline
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Magenta
Write-Host "        GITHUB REPOSITORY SECRETS" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Magenta
Write-Host "`nSet these secrets in your GitHub repository:" -ForegroundColor Yellow
Write-Host "  (https://github.com/thermaltrue/wms/settings/secrets/actions)`n"
Write-Host "  gh secret set WINDOWS_CERTIFICATE --body ""$PfxBase64""" -ForegroundColor White
Write-Host "  gh secret set WINDOWS_CERTIFICATE_PASSWORD --body ""$Password""" -ForegroundColor White
Write-Host "`nOr manually from the GitHub UI:" -ForegroundColor Yellow
Write-Host "  Name: WINDOWS_CERTIFICATE" -ForegroundColor Gray
Write-Host "  Value: (base64-encoded PFX file contents)" -ForegroundColor Gray
Write-Host "  Name: WINDOWS_CERTIFICATE_PASSWORD" -ForegroundColor Gray
Write-Host "  Value: $Password" -ForegroundColor Gray

Write-Host "`nDone. Certificate saved to $PfxPath" -ForegroundColor Green
