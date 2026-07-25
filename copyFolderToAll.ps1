$root = "images"
$source = Join-Path $root "1022"
$folders = @(
"AMAU","AT99","SKS1","03A3","SVAX","RU91","NE11","LEJC","FRM1","FRM2","AR10","GG43","M1A1","RU40","FN49","EHAK","FR36","MAR1","MAR2","MAR3","WM70","M1-1","M1-2","M1C1","R700","SAX2","R111","R112","B686","RM10","WOLF"
)
$files = Get-ChildItem $source -File

foreach ($name in $folders) {
    $dest = Join-Path $root $name
    foreach ($file in $files) {
        $newName = $file.Name -replace '^1022', $name
        $destPath = Join-Path $dest $newName
        Copy-Item $file.FullName $destPath -Force
        Write-Host \"Copied $($file.Name) as $newName to $dest\"
    }
}