

# PowerShell Script - Build an image index (images.json) for a folder of images, optionally iterating every subfolder.
#
# Call:  .\build-image-index.ps1 -Root "Z:\Docs\code\collection\pub\images\M1-1\"
param(
    [Parameter(Mandatory=$false)]
    [string]$Root = "images",
    [switch]$All   # pass -All to iterate every subfolder
)

if (-not (Test-Path $Root -PathType Container)) {
    Write-Error "Folder not found: $Root"
    exit 1
}

function Update-ImageIndex {
    param([string]$FolderPath)

    $files = Get-ChildItem -LiteralPath $FolderPath -File |
        Where-Object { $_.Extension -match '^\.(jpg|jpeg|png|svg)$' } |
        Sort-Object Name |
        Select-Object -ExpandProperty Name

    if (-not $files) { $files = @() }

    $jsonPath = Join-Path $FolderPath "images.json"
    $files | ConvertTo-Json | Set-Content $jsonPath

    Write-Host "Updated: $jsonPath"
    Write-Host "  Files: $($files -join ', ')"
}

if ($All) {
    # Iterate every subfolder under $Root
    Get-ChildItem -LiteralPath $Root -Directory | ForEach-Object {
        Update-ImageIndex -FolderPath $_.FullName
    }
} else {
    # Process $Root itself — exactly the folder you passed
    Update-ImageIndex -FolderPath $Root
}