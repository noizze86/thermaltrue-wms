param(
    [int]$Port = 3000
)
$ErrorActionPreference = "Stop"
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$report = Join-Path $appDir "readiness-report.json"

function Write-Report {
    param($healthy, $details)
    $obj = [ordered]@{
        timestamp = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
        apiPort = $Port
        service = "ThermaltrueServer"
        serverReachable = $healthy
        health = $details
    }
    $obj | ConvertTo-Json -Depth 4 | Set-Content -Path $report -Encoding utf8
}

Write-Host "Selftest: checking http://127.0.0.1:$Port/api/health"
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health/db" -TimeoutSec 3 -UseBasicParsing
        if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch {}
}
if ($ok) {
    $body = $r.Content | ConvertFrom-Json
    Write-Host "Selftest OK: $($body.status)"
    Write-Status $true $body
} else {
    Write-Host "Selftest FAILED: server not reachable on port $Port"
    Write-Status $false $null
    exit 2
}