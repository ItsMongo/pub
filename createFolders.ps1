$root = "images"  # Change to your target directory if needed

$folders = @(
"LE41","1022","AMAU","K981","AT99","SKS1","03A3","SVAX","RU91","NE11","AR15","LEJC","FRM1","FRM2","AR10","GG43","M1A1","RU40","FN49","EHAK","FR36","MAR1","MAR2","MAR3","WM70","M1-1","M1-2","M1C1","R700","SAX2","R111","R112","B686","RM10","WOLF"
)

foreach ($name in $folders) {
    $path = Join-Path $root $name
    if (-not (Test-Path $path)) {
        New-Item -Path $path -ItemType Directory | Out-Null
        Write-Host "Created: $path"
    } else {
        Write-Host "Exists: $path"
    }
}