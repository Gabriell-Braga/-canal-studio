# Canal Studio - updates the app opened from the desktop shortcut.
# Usage: npm run deploy:desktop
#   1. builds out/ (typecheck + electron-vite)
#   2. recreates the "Canal Studio" desktop shortcut
#   3. if the app is running, restarts it on the new build

$ErrorActionPreference = 'Stop'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host 'Compilando...' -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host 'Build falhou; atalho nao foi alterado.' -ForegroundColor Red; exit 1 }

$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$desktop = [Environment]::GetFolderPath('Desktop')
$link = Join-Path $desktop 'Canal Studio.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = $electron
$shortcut.Arguments = "`"$root`""
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = (Join-Path $root 'resources\icon.ico') + ',0'
$shortcut.Description = 'Canal Studio'
$shortcut.Save()
Write-Host "Atalho atualizado: $link" -ForegroundColor Green

# Main app processes only (Chromium helpers carry --type=).
function Get-AppProcess {
  Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
    Where-Object { $_.CommandLine -notmatch '--type=' -and $_.CommandLine -match [regex]::Escape($root) }
}

$running = @(Get-AppProcess)
if ($running.Count -eq 0) {
  Write-Host 'App nao estava aberto. Abra pelo atalho quando quiser.'
  exit 0
}

Write-Host 'App aberto: reiniciando na versao nova...' -ForegroundColor Cyan
# A newer build asks the running one to restart itself (single-instance hand-off).
Start-Process -FilePath $electron -ArgumentList "`"$root`"" -WorkingDirectory $root
Start-Sleep -Seconds 8
$old = $running | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
if ($old) {
  # Builds from before the hand-off existed: stop them and start again.
  Write-Host "Versao antiga sem troca automatica; encerrando $($old.ProcessId)" -ForegroundColor Yellow
  $old | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -match 'uvicorn server:app' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Start-Sleep -Seconds 2
  Start-Process -FilePath $electron -ArgumentList "`"$root`"" -WorkingDirectory $root
}
Write-Host 'App reiniciado na versao nova.' -ForegroundColor Green
