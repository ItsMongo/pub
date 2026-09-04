# -----------------------------------------------------------------------------
# scripts/deploy.ps1 - push the web app from this dev folder to the Shield's
# served folder (mounted locally as Z:, an SMB share over WiFi).
#
#   powershell -ExecutionPolicy Bypass -File scripts/deploy.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/deploy.ps1 -WhatIf
#
# Copies only the app files that change, one at a time with plain Copy-Item.
# robocopy is avoided here: it tries to replicate NTFS attributes onto the
# Android SMB share, which rejects them, and its default retry policy then
# hangs for many minutes. Nothing on the target is ever deleted, so images/
# and flags/ are left alone.
#
# The DATABASE is not deployed this way - SHTTPS+ on Android keeps its own
# database.db and is updated over the network:
#   node scripts/push-to-shttps.js http://<shield-ip>:8080 --user=NAME --pass=SECRET
# -----------------------------------------------------------------------------

param(
    [string]$Target = 'Z:\Docs\code\collection\pub',
    [switch]$WhatIf
)

$src = Split-Path -Parent $PSScriptRoot   # the pub/ folder

if (-not (Test-Path -LiteralPath $Target)) {
    Write-Error "Target not found: $Target  (is the Shield share mounted / awake?)"
    exit 1
}

# Exactly the files the running app loads. Relative paths under pub/.
$files = @(
    'mycollection.html',
    'js\app.js',
    'js\db.js',
    'css\styles.css',
    'data\firearms.json'
)

function Get-Md5($p) {
    if (-not (Test-Path -LiteralPath $p)) { return $null }
    (Get-FileHash -LiteralPath $p -Algorithm MD5).Hash
}

Write-Host "Deploy  $src  ->  $Target" -ForegroundColor Cyan

$copied = 0
$failed = 0
foreach ($rel in $files) {
    $from = Join-Path $src    $rel
    $to   = Join-Path $Target $rel

    if (-not (Test-Path -LiteralPath $from)) {
        Write-Warning "skip (missing locally): $rel"
        continue
    }

    if ((Get-Md5 $from) -eq (Get-Md5 $to)) {
        Write-Host ("  {0,-22} already current" -f $rel) -ForegroundColor DarkGray
        continue
    }

    if ($WhatIf) {
        Write-Host ("  {0,-22} would copy" -f $rel) -ForegroundColor Yellow
        continue
    }

    $toDir = Split-Path -Parent $to
    if (-not (Test-Path -LiteralPath $toDir)) {
        New-Item -ItemType Directory -Path $toDir -Force | Out-Null
    }

    try {
        Copy-Item -LiteralPath $from -Destination $to -Force -ErrorAction Stop
        Write-Host ("  {0,-22} copied" -f $rel) -ForegroundColor Green
        $copied++
    }
    catch {
        Write-Host ("  {0,-22} FAILED - {1}" -f $rel, $_.Exception.Message) -ForegroundColor Red
        $failed++
    }
}

Write-Host ""
if ($WhatIf) {
    Write-Host "(dry run - nothing copied)" -ForegroundColor Cyan
}
else {
    $tail = "$copied file(s) updated on the Shield."
    if ($failed -gt 0) {
        $tail = "$copied updated, $failed FAILED - rerun; the share may have dropped."
    }
    Write-Host $tail -ForegroundColor Cyan
    Write-Host "Data changes go separately:" -ForegroundColor Yellow
    Write-Host "  node scripts/push-to-shttps.js http://<shield-ip>:8080 --user=NAME --pass=SECRET" -ForegroundColor Yellow
}
