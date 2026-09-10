Get-ChildItem -Path ".\*.jpg" | ForEach-Object {

    Rename-Item -Path $_.FullName -NewName ("MAR2-_A3-" + $_.Name)

}