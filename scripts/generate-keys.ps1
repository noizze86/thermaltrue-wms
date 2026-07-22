<#
.SYNOPSIS
    Generate Tauri signing key pair and output GitHub Secrets format.
.DESCRIPTION
    Generates a new Tauri signing key pair, saves it to $HOME\.tauri-key(.pub),
    and outputs the values formatted for GitHub repository secrets.
.PARAMETER Password
    Password for the private key. If not provided, prompts interactively.
.PARAMETER Force
    Overwrite existing keys without prompting.
.PARAMETER Ci
    Skip interactive prompts (non-interactive mode).
.PARAMETER SkipConfig
    Skip updating tauri.conf.json with the new pubkey.
.EXAMPLE
    .\scripts\generate-keys.ps1 -Password "my-secure-password"
.EXAMPLE
    .\scripts\generate-keys.ps1 -Ci
#>

param(
    [Parameter(Mandatory = $false)]
    [string]$Password = "",

    [switch]$Force,

    [switch]$Ci,

    [switch]$SkipConfig
)

$ErrorActionPreference = "Stop"
$PrivateKeyPath = "$env:USERPROFILE\.tauri-key"
$PublicKeyPath = "$env:USERPROFILE\.tauri-key.pub"
$TauriCliRel = "node_modules\.bin\tauri.cmd"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$TauriConf = "$ProjectRoot\src-tauri\tauri.conf.json"

# ── Prerequisites ───────────────────────────────────────────────────────

function Test-Command($cmd) {
    try { Get-Command $cmd -ErrorAction Stop | Out-Null; return $true }
    catch { return $false }
}

if (-not (Test-Command "node")) {
    Write-Error "Node.js is required but not found. Install from https://nodejs.org"
    exit 1
}

$TauriCli = Join-Path $ProjectRoot $TauriCliRel
if (-not (Test-Path $TauriCli)) {
    Write-Warning "Tauri CLI not found at $TauriCliRel. Running npm install..."
    Push-Location $ProjectRoot
    npm install
    Pop-Location
    if (-not (Test-Path $TauriCli)) {
        Write-Error "npm install did not install Tauri CLI. Check your package.json."
        exit 1
    }
}

# ── Check existing keys ─────────────────────────────────────────────────

if ((Test-Path $PrivateKeyPath) -or (Test-Path $PublicKeyPath)) {
    if ($Ci -or $Force) {
        Write-Warning "Overwriting existing keys at $PrivateKeyPath"
    } else {
        $answer = Read-Host "Keys already exist at $env:USERPROFILE\.tauri-key(.pub). Overwrite? (y/N)"
        if ($answer -ne "y" -and $answer -ne "Y") {
            Write-Host "Aborted. Existing keys preserved." -ForegroundColor Yellow
            exit 0
        }
    }
}

# ── Get password ────────────────────────────────────────────────────────

if (-not $Password) {
    if ($Ci) {
        $Password = [System.Guid]::NewGuid().ToString()
        Write-Host "CI mode: auto-generated password: $Password" -ForegroundColor Cyan
    } else {
        $secure = Read-Host "Enter password for private key" -AsSecureString
        $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        $Password = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)
        if (-not $Password) {
            Write-Error "Password cannot be empty"
            exit 1
        }
    }
}

# ── Generate keys ───────────────────────────────────────────────────────

Write-Host "Generating Tauri signing key pair..."
$TauriArgs = @(
    "signer", "generate",
    "-w", $PrivateKeyPath,
    "-p", $Password,
    "--ci"
)
if ($Force) { $TauriArgs += "-f" }

$result = & $TauriCli @TauriArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "Key generation failed with exit code $LASTEXITCODE"
    exit 1
}
Write-Host $result
Write-Host "Keys generated successfully." -ForegroundColor Green

# ── Validate generated files ────────────────────────────────────────────

if (-not (Test-Path $PrivateKeyPath)) {
    Write-Error "Private key not found at $PrivateKeyPath"
    exit 1
}
if (-not (Test-Path $PublicKeyPath)) {
    Write-Error "Public key not found at $PublicKeyPath"
    exit 1
}

# ── Read public key ─────────────────────────────────────────────────────

$PublicKey = (Get-Content $PublicKeyPath -Raw).Trim()
$PrivateKeyContent = (Get-Content $PrivateKeyPath -Raw).Trim()

# ── Output GitHub Secrets format ────────────────────────────────────────

Write-Host "`n" -NoNewline
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Magenta
Write-Host "        GITHUB REPOSITORY SECRETS" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Magenta
Write-Host "`nSet these secrets in your GitHub repository:" -ForegroundColor Yellow
Write-Host "  (https://github.com/thermaltrue/wms/settings/secrets/actions)`n"
Write-Host "  gh secret set TAURI_PRIVATE_KEY --body ""$PrivateKeyContent""" -ForegroundColor White
Write-Host "  gh secret set TAURI_KEY_PASSWORD --body ""$Password""" -ForegroundColor White
Write-Host "  gh secret set TAURI_PUBLIC_KEY --body ""$PublicKey""" -ForegroundColor White
Write-Host "`nOr manually from the GitHub UI:" -ForegroundColor Yellow
Write-Host "  Name: TAURI_PRIVATE_KEY" -ForegroundColor Gray
Write-Host "  Value: (base64-encoded private key file contents)" -ForegroundColor Gray
Write-Host "  Name: TAURI_KEY_PASSWORD" -ForegroundColor Gray
Write-Host "  Value: $Password" -ForegroundColor Gray
Write-Host "  Name: TAURI_PUBLIC_KEY" -ForegroundColor Gray
Write-Host "  Value: $PublicKey" -ForegroundColor Gray

# ── Write public key reference file ─────────────────────────────────────

$ProjectPubKey = "$ProjectRoot\tauri-updater.pub"
Set-Content -Path $ProjectPubKey -Value $PublicKey -NoNewline
Write-Host "`nPublic key copied to $ProjectPubKey (for reference)" -ForegroundColor Cyan

# ── Update tauri.conf.json ──────────────────────────────────────────────

if (-not $SkipConfig) {
    $UpdateConfig = $false
    if ($Ci -or $Force) {
        $UpdateConfig = $true
    } else {
        $answer = Read-Host "Update tauri.conf.json with new pubkey? (Y/n)"
        if ($answer -ne "n" -and $answer -ne "N") {
            $UpdateConfig = $true
        }
    }

    if ($UpdateConfig) {
        if (Test-Path $TauriConf) {
            $config = Get-Content $TauriConf -Raw | ConvertFrom-Json
            if ($config.plugins.updater.pubkey -ne $PublicKey) {
                $config.plugins.updater.pubkey = $PublicKey
                $config | ConvertTo-Json -Depth 10 | Set-Content $TauriConf
                Write-Host "Updated pubkey in $TauriConf" -ForegroundColor Green
            } else {
                Write-Host "Pubkey in tauri.conf.json is already up to date." -ForegroundColor Green
            }
        } else {
            Write-Warning "tauri.conf.json not found at $TauriConf"
        }
    }
} else {
    Write-Host "`nPubkey for tauri.conf.json plugins.updater.pubkey:" -ForegroundColor Yellow
    Write-Host $PublicKey -ForegroundColor Cyan
}

Write-Host "`nDone." -ForegroundColor Green
