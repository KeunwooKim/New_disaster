# API 발급 링크

키는 브라우저에서 직접 발급받아야 합니다. 발급 후 `/home/kim/urban-alert/.env.local`에 붙여 넣고 `pm2 restart urban-alert` 하세요.

## 1. 재난문자 (재난안전데이터공유플랫폼)

공공데이터포털의 예전 `DisasterMsg2`/`DisasterMsg3`는 폐기되었습니다. 대체 API는 **행정안전부_긴급재난문자 `DSSP-IF-00247`** 입니다.

1. 회원가입: https://www.safetydata.go.kr
2. 이용신청: https://www.safetydata.go.kr/disaster-data/view?dataSn=228  
   (공공데이터포털 링크: https://www.data.go.kr/data/15134001/openapi.do)
3. 마이페이지 → 데이터 이용 내역 / API키 발급 내역에서 서비스키 확인  
   URL: `/V2/api/DSSP-IF-00247?serviceKey=...`
4. `.env.local`의 `DATA_GO_KR_KEY=` 에 그 서비스키를 넣습니다.

호출 예: `https://www.safetydata.go.kr/V2/api/DSSP-IF-00247?serviceKey=키&returnType=json&pageNo=1&numOfRows=10&crtDt=YYYYMMDD`

## 2. 실종 (안전Dream)

1. 안내: https://www.safe182.go.kr/home/api/guideMain.do
2. 인증키 발급: https://www.safe182.go.kr/home/api/authKey1Create.do  
   휴대폰 본인인증이 필요합니다. 발급값: `esntlId`, `authKey`
3. 실종경보 API 명세: https://www.safe182.go.kr/home/api/guide3.do
4. 실종검색 API 명세: https://www.safe182.go.kr/home/api/guide5.do
5. `.env.local`의 `SAFE182_ESNTL_ID=`, `SAFE182_AUTH_KEY=` 에 넣습니다.

공공데이터포털 경유 신청도 가능합니다.  
https://www.data.go.kr/data/3051810/openapi.do (경찰청_실종경보정보)

## 3. Hugging Face (장소 추출)

유형·요약은 앱 규칙이 담당합니다. Hugging Face는 원문에서 **지명만** 뽑습니다.

1. 계정: https://huggingface.co/join
2. 토큰 발급: https://huggingface.co/settings/tokens  
   Fine-grained 토큰에서 **Make calls to Inference Providers** 권한을 켭니다.  
   앱 기본 모델은 `moonshotai/Kimi-K2-Instruct` 입니다 (`Qwen2.5`는 이 토큰에서 미지원).
3. `.env.local`의 `HF_TOKEN=` 에 넣습니다.

## 4. 공공데이터포털 (기상특보·지진·태풍·산사태)

재난문자 키(`DATA_GO_KR_KEY`)와 **다른 포털 일반 인증키**입니다. 활용신청 후 `.env.local`의 `DATA_GO_KR_PORTAL_KEY=` 에 넣습니다. 키는 채팅에 붙여 넣지 마세요.

| 서비스 | 신청 | 엔드포인트 |
|---|---|---|
| 기상특보 | https://www.data.go.kr/data/15000415/openapi.do | `.../WthrWrnInfoService` |
| 지진 | https://www.data.go.kr/data/15000420/openapi.do | `.../EqkInfoService` |
| 태풍 | https://www.data.go.kr/data/15043565/openapi.do | `.../TyphoonInfoService` |
| 산사태 예측 | https://www.data.go.kr/data/15074800/openapi.do | `.../predictionInfoService` |

단기예보(`VilageFcstInfoService_2.0`)는 격자 날씨라 수집하지 않습니다.

## 5. 재난문자 HTML 목록 (키 없이 아카이브)

목록 페이지는 로그인 없이 수집 가능합니다.

```bash
python3 scripts/fetch-safetydata-sms.py
```
