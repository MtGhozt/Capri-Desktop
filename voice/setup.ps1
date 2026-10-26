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
}
& $venvPy -m pip install -U pip
& $venvPy -m pip install -r (Join-Path $Root 'requirements.txt')
New-Item -ItemType Directory -Force -Path (Join-Path $Root 'models') | Out-Null
Write-Host 'Voice sidecar ready. Models (Whisper, wake word, Kokoro) download on first run into voice/models/.'
