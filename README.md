# 도심 재난 알림

논문 「도심 환경에서 재난 위치 판별을 통한 알림 서비스」를 웹앱으로 재구현한 서비스입니다.

재난문자와 실종 API를 수집하고, 유형·요약은 규칙으로, 장소는 Hugging Face LLM으로 뽑아 지도에 표시합니다. 시민 제보는 포함하지 않습니다.

## 실행

```bash
cp .env.example .env.local
# DATA_GO_KR_KEY, SAFE182_ESNTL_ID, SAFE182_AUTH_KEY, HF_TOKEN 입력

npm install
npm run dev          # http://127.0.0.1:3001
```

키가 없어도 샘플 이벤트로 지도를 볼 수 있습니다. 화면의 **지금 수집**으로 실시간 API를 당깁니다.

운영:

```bash
npm run build
POLL_ENABLED=1 pm2 start ecosystem.config.cjs
```

PhotoWall(`:3000`)과 Caddy는 변경하지 않습니다. 접속은 `127.0.0.1:3001` 또는 Tailscale입니다.

## 환경 변수

키 발급 링크와 넣는 위치는 [docs/API.md](docs/API.md)를 보세요.

| 키 | 설명 |
|---|---|
| `DATA_GO_KR_KEY` | 재난안전데이터 `DSSP-IF-00247` 서비스키 |
| `SAFE182_ESNTL_ID` / `SAFE182_AUTH_KEY` | 안전Dream 실종 API |
| `HF_TOKEN` | Hugging Face 토큰 |
| `POLL_ENABLED=1` | 4분 간격 자동 수집 |

지난 재난문자는 `data/raw/disaster-sms.csv`에 저장합니다.

```bash
python3 scripts/fetch-safetydata-sms.py
```

실종자 사진은 LLM에 보내지 않습니다. 분석은 텍스트만 사용합니다.
