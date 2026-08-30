Get-ChildItem -Path $TargetDir -Filter "CZ50-*" -File | ForEach-Object {
    $newName = $_.Name -replace '^CZ50-', 'VZ50-'
    Write-Host "Renaming: $($_.Name)  ->  $newName"
    Rename-Item -Path $_.FullName -NewName $newName
}