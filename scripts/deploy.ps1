# ─────────────────────────────────────────────────────────────────────────────
# scripts/deploy.ps1 — push the web app from this dev folder to the Shield's
# served folder (mounted locally as Z:). Static files only.
#
#   powershell -ExecutionPolicy Bypass -File scripts/deploy.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/deploy.ps1 -WhatIf
#
# The DATABASE is not deployed this way — SHTTPS+ on Android keeps its own
# database.db and is updated over the network:
#   $env:SHTTPS_URL='http://<shield-ip>:8080'; node scripts/push-to-shttps.js
# ─────────────────────────────────────────────────────────────────────────────

param(
    [string]$Target = 'Z:\Docs\code\collection\pub',
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $PSScriptRoot   # the pub/ folder

if (-not (Test-Path $Target)) {
    Write-Error "Target not found: $Target  (is the Shield drive mounted?)"
}

# Files/folders the running app actually needs. images/ and flags/ are big and
# already on the Shield — deploy those manually when they change.
$items = @(
    'mycollection.html',
    'css',
    'js',
    'data\firearms.json'   # fallback snapshot used by js/db.js when the API is down
)

Write-Host "Deploy  $src  ->  $Target" -ForegroundColor Cyan

foreach ($item in $items) {
    $from = Join-Path $src $item
    if (-not (Test-Path $from)) { Write-Warning "skip (missing): $item"; continue }

    if ((Get-Item $from).PSIsContainer) {
        $to = Join-Path $Target $item
        $rc = @($from, $to, '/E', '/PURGE', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
        if ($WhatIf) { $rc += '/L' }
        robocopy @rc | Out-Null
        Write-Host "  dir   $item" -ForegroundColor Green
    } else {
        $to = Join-Path $Target $item
        if ($WhatIf) {
            Write-Host "  file  $item  (would copy)" -ForegroundColor DarkGray
        } else {
            New-Item -ItemType Directory -Force -Path (Split-Path $to) | Out-Null
            Copy-Item $from $to -Force
            Write-Host "  file  $item" -ForegroundColor Green
        }
    }
}

Write-Host ""
Write-Host "Static files deployed." -ForegroundColor Cyan
Write-Host "Remember: to update the live data, run push-to-shttps.js against the Shield." -ForegroundColor Yellow
