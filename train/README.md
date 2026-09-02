# 재난문자 지명 NER 학습

법정동 사전으로 만든 **실버 라벨**입니다. 사람이 검수한 정답은 아닙니다.

라벨: `SIDO` 시·도, `SGG` 시·군·구, `EMD` 읍·면·동, `RI` 리, `FAC` 교량·하상도로.

`prepare.py`, `train_ner.py`, `data\train.jsonl`이 보이면 이미 압축이 풀린 상태입니다. `tar`나 `cd train`은 하지 마세요.

---

## Windows (PowerShell)

프롬프트가 `...\Downloads\train\train>` 처럼 되어 있으면 그 폴더가 맞습니다.

```powershell
dir
# prepare.py, train_ner.py, data 가 보여야 합니다.

python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -U pip
python -m pip install torch --index-url https://download.pytorch.org/whl/cu124
python -m pip install -r requirements.txt
python train_ner.py --epochs 3 --batch-size 16
```

`Activate.ps1`이 막히면:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

PowerShell 5에서는 `&&`와 `source`가 안 됩니다. 활성화 스크립트는 Linux의 `.venv/bin/activate`가 아니라 `.\.venv\Scripts\Activate.ps1`입니다.

이미 `pip install torch`가 돌아가고 있으면 끝까지 기다리세요. 같은 Python이면 가상환경 없이 바로:

```powershell
python -m pip install -r requirements.txt
python train_ner.py --epochs 3 --batch-size 16
```

VRAM이 8GB 이하면:

```powershell
python train_ner.py --model monologg/koelectra-small-v3-discriminator --batch-size 8
```

---

## Linux / macOS

```bash
tar xzf urban-alert-ner.tar.gz
cd train
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install torch --index-url https://download.pytorch.org/whl/cu124
pip install -r requirements.txt
python train_ner.py --epochs 3 --batch-size 16
```

---

## 결과

`output/koelectra-ner/` (`config.json`, 가중치, `metrics.json`).

짧게 동작만 보려면:

```powershell
python train_ner.py --max-steps 20 --epochs 1 --out output/smoke
```

확인:

```powershell
python infer.py --text "<통제해제>잠수교(야막리 159일원) [오산시]"
python infer.py --file data/test.jsonl
```

학습이 끝나면 `output/koelectra-ner` 폴더를 서버로 다시 복사하면 됩니다.
