$ErrorActionPreference = 'Continue'
$target = 'F:\agentai-platform\packages\agentai-desktop\src-tauri\resources\gateway-dist-backup-1784464616055'

if (-not (Test-Path 'F:\empty_for_robocopy')) {
    New-Item -ItemType Directory -Path 'F:\empty_for_robocopy' -Force | Out-Null
}

Write-Host "Step1: robocopy mirror"
robocopy 'F:\empty_for_robocopy' $target /MIR /NFL /NDL /NJH /NJS /R:0 /W:0 2>&1 | Out-Null
Write-Host "robocopy exit: $LASTEXITCODE"

Write-Host "Step2: remove"
try {
    Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
    Write-Host "Remove-Item OK"
} catch {
    Write-Host "Remove-Item failed: $_"
    cmd /c "rd /s /q `"$target`"" 2>&1 | Out-Null
}

if (Test-Path $target) {
    Write-Host "STILL EXISTS"
} else {
    Write-Host "DELETED OK"
}

Remove-Item -Path 'F:\empty_for_robocopy' -Force -ErrorAction SilentlyContinue
