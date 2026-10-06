# Canal Studio - verifica dependencias do ambiente.
# Uso: npm run check-setup   (ou: powershell -ExecutionPolicy Bypass -File scripts/check-setup.ps1)

param(
  [string]$ComfyPath = 'D:\ComfyUI_windows_portable',
  [string]$OllamaModel = 'qwen3:14b'
)

$ErrorActionPreference = 'SilentlyContinue'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
$root = Split-Path -Parent $PSScriptRoot
$missing = 0

function Report([string]$name, [string]$state, [string]$info) {
  $color = @{ OK = 'Green'; ATENCAO = 'Yellow'; FALTA = 'Red' }[$state]
  Write-Host ('[{0,-7}] ' -f $state) -ForegroundColor $color -NoNewline
  Write-Host ('{0,-24} {1}' -f $name, $info)
  if ($state -eq 'FALTA') { $script:missing++ }
}

function FirstLine([scriptblock]$cmd) {
  $out = & $cmd 2>&1 | Select-Object -First 1
  if ($LASTEXITCODE -eq 0 -or $out) { return "$out".Trim() }
  return $null
}

Write-Host "`nCanal Studio - verificacao do ambiente`n"

$v = FirstLine { node -v }
if ($v) { Report 'Node.js' 'OK' $v } else { Report 'Node.js' 'FALTA' 'winget install OpenJS.NodeJS.LTS' }

$v = FirstLine { npm -v }
if ($v) { Report 'npm' 'OK' $v } else { Report 'npm' 'FALTA' 'vem com o Node.js' }

$v = FirstLine { py -3.11 --version }
if ($v -match 'Python 3\.11') { Report 'Python 3.11' 'OK' $v } else { Report 'Python 3.11' 'FALTA' 'winget install Python.Python.3.11' }

$v = FirstLine { git --version }
if ($v) { Report 'Git' 'OK' $v } else { Report 'Git' 'FALTA' 'winget install Git.Git' }

$v = FirstLine { ffmpeg -version }
if ($v -match 'ffmpeg version (\S+)') { Report 'FFmpeg' 'OK' $Matches[1] } else { Report 'FFmpeg' 'FALTA' 'winget install Gyan.FFmpeg' }

$v = FirstLine { nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader }
if ($v) { Report 'GPU NVIDIA' 'OK' $v } else { Report 'GPU NVIDIA' 'FALTA' 'instale o driver NVIDIA' }

$v = ollama --version 2>&1 | Out-String
if ($v -match 'version is (\S+)') {
  try {
    $tags = Invoke-RestMethod 'http://localhost:11434/api/tags' -TimeoutSec 3
    Report 'Ollama' 'OK' "$($Matches[1]) (rodando)"
    if ($tags.models.name -contains $OllamaModel) { Report "Modelo $OllamaModel" 'OK' 'baixado' }
    else { Report "Modelo $OllamaModel" 'FALTA' "ollama pull $OllamaModel (~9 GB)" }
  } catch {
    Report 'Ollama' 'ATENCAO' "$($Matches[1]) instalado, servico parado"
  }
} else { Report 'Ollama' 'FALTA' 'winget install Ollama.Ollama' }

if (Test-Path (Join-Path $ComfyPath 'ComfyUI\main.py')) {
  try {
    Invoke-RestMethod 'http://127.0.0.1:8188/system_stats' -TimeoutSec 3 | Out-Null
    Report 'ComfyUI' 'OK' "$ComfyPath (rodando)"
  } catch { Report 'ComfyUI' 'ATENCAO' "$ComfyPath (parado)" }
  $ckpts = Get-ChildItem (Join-Path $ComfyPath 'ComfyUI\models\checkpoints') -Filter *.safetensors
  if ($ckpts) { Report 'Modelo de imagem' 'OK' ($ckpts.Name -join ', ') } else { Report 'Modelo de imagem' 'FALTA' 'SDXL base 1.0 em models\checkpoints' }
} else { Report 'ComfyUI' 'FALTA' "nao encontrado em $ComfyPath" }

$v = FirstLine { espeak-ng --version }
if ($v -or (Test-Path 'C:\Program Files\eSpeak NG\espeak-ng.exe')) { Report 'eSpeak NG' 'OK' "$v" } else { Report 'eSpeak NG' 'ATENCAO' 'necessario na Fase 3' }

if (Test-Path (Join-Path $root 'python\venv\Scripts\python.exe')) {
  try {
    Invoke-RestMethod 'http://127.0.0.1:8765/health' -TimeoutSec 3 | Out-Null
    Report 'Servidor Python' 'OK' 'rodando na porta 8765'
  } catch { Report 'Servidor Python' 'ATENCAO' 'venv existe, servidor parado' }
} else { Report 'Servidor Python' 'ATENCAO' 'venv ainda nao criado (Fase 3)' }

if (Test-Path (Join-Path $root 'node_modules')) { Report 'Dependencias npm' 'OK' 'node_modules presente' } else { Report 'Dependencias npm' 'FALTA' 'rode: npm install' }

Write-Host ''
if ($missing -eq 0) { Write-Host 'Tudo essencial esta instalado.' -ForegroundColor Green }
else { Write-Host "$missing item(ns) faltando." -ForegroundColor Red }
exit $missing
