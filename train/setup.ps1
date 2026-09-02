# Windows에서 가상환경 만들고 학습 패키지를 설치합니다.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".\train_ner.py")) {
    Write-Error "train_ner.py 가 없습니다. Downloads\train\train 처럼 prepare.py 가 있는 폴더에서 실행하세요."
}

if (-not (Test-Path ".\.venv")) {
    python -m venv .venv
}

$activate = Join-Path $PSScriptRoot ".venv\Scripts\Activate.ps1"
. $activate

python -m pip install -U pip
python -m pip install torch --index-url https://download.pytorch.org/whl/cu124
python -m pip install -r requirements.txt
Write-Host "준비 완료. 다음을 실행하세요:"
Write-Host "  .\.venv\Scripts\Activate.ps1"
Write-Host "  python train_ner.py --epochs 3 --batch-size 16"
