param(
  [switch]$OmniVoice
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
Set-Location $Root

function Find-Python311 {
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    $exe = & py -3.11 -c "import sys; print(sys.executable)" 2>$null
    if ($LASTEXITCODE -eq 0 -and $exe) { return ([string]$exe).Trim() }
  }
  foreach ($name in @('python3.11', 'python')) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $cmd) { continue }
    $ver = & $cmd.Source -c "import sys; print('%d.%d' % (sys.version_info.major, sys.version_info.minor))"
    if (([string]$ver).Trim() -eq '3.11') { return $cmd.Source }
  }
  throw 'Python 3.11 not found. Install it and ensure `py -3.11` works.'
}

$python = Find-Python311
Write-Host "Using $python"
$venv = Join-Path $Root '.venv'
$venvPy = Join-Path $venv 'Scripts\python.exe'
if (-not (Test-Path $venvPy)) {
  & $python -m venv $venv
  if ($LASTEXITCODE -ne 0) { throw "No se pudo crear el .venv (exit $LASTEXITCODE)." }
}

# Native commands do not throw on a non-zero exit: a failed pip step used to finish as "Listo".
function Invoke-Pip {
  & $venvPy -m pip @args
  if ($LASTEXITCODE -ne 0) { throw "Falló pip $($args -join ' ') (exit $LASTEXITCODE)." }
}

Invoke-Pip install -U pip
Invoke-Pip install -r (Join-Path $Root 'requirements.txt')
& $venvPy -c "from openwakeword.utils import download_models; download_models()"
if ($LASTEXITCODE -ne 0) { throw "Falló la descarga del wake word (exit $LASTEXITCODE)." }
if ($OmniVoice) {
  Write-Host 'Installing pinned PyTorch CUDA (torch/torchaudio 2.11.0+cu130) + OmniVoice. First run downloads k2-fsa/OmniVoice.'
  Invoke-Pip install --upgrade -r (Join-Path $Root 'requirements-torch.txt')
  Invoke-Pip install -r (Join-Path $Root 'requirements-omnivoice.txt')
  & $venvPy -m pip check
  # The sidecar runs this same python: "Listo" only if torch and omnivoice import here.
  & $venvPy -c "import torch, omnivoice"
  if ($LASTEXITCODE -ne 0) { throw "La voz quedó instalada pero torch/omnivoice no importan con $venvPy (ver el error de arriba)." }
}
New-Item -ItemType Directory -Force -Path (Join-Path $Root 'models') | Out-Null
Write-Host 'Voice sidecar ready. Models (Whisper, wake word, Kokoro) download on first run into voice/models/.'
if ($OmniVoice) {
  Write-Host 'OmniVoice extra installed. Put capri_ref_short.wav + .txt in voice/ref/ (gitignored).'
}
