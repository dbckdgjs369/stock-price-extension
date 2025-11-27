# Crypto Price Tab Extension

현재 활성화된 탭에서만 코인 가격을 탭 타이틀에 표시하는 Chrome 익스텐션

## 설치 방법

1. Chrome 브라우저에서 `chrome://extensions/` 열기
2. 오른쪽 상단 **개발자 모드** 활성화
3. **압축해제된 확장 프로그램 로드하기** 클릭
4. 이 프로젝트 폴더 선택

## 재설치 방법 (문제 해결)

문제가 발생하면 다음 단계로 완전히 재설치:

1. `chrome://extensions/` 에서 "Crypto Price in Tab" 찾기
2. **제거** 버튼 클릭
3. 페이지 새로고침 (F5)
4. **압축해제된 확장 프로그램 로드하기**로 다시 설치
5. **모든 탭 새로고침** (중요!)

## 작동 방식

- **활성 탭**: `BITCOIN: $50,000.00 / ₩65,000,000`
- **비활성 탭**: 원래 페이지 제목 유지
- **자동 업데이트**: 30초마다 가격 갱신

## 디버깅

### 1. 익스텐션이 로드되었는지 확인

- `chrome://extensions/` 에서 "Crypto Price in Tab"이 **활성화** 되어 있는지 확인

### 2. 콘솔 에러 확인

- `chrome://extensions/` 에서 "Crypto Price in Tab" 찾기
- **배경 페이지** 또는 **서비스 워커** 링크 클릭
- Console 탭에서 에러 메시지 확인

### 3. 페이지에서 에러 확인

- 임의의 웹페이지에서 F12 → Console 탭
- 에러 메시지 확인

### 4. 권한 확인

- manifest.json의 permissions에 다음이 포함되어야 함:
  - `storage`, `alarms`, `tabs`, `scripting`
  - `host_permissions`: `https://api.coingecko.com/*`

## 테스트 방법

1. 익스텐션 설치
2. 새 탭 열기 (예: `https://www.google.com`)
3. 탭 타이틀 확인 → 코인 가격이 표시되어야 함
4. 다른 탭으로 전환
5. 이전 탭은 원래 제목으로 복구됨
6. 다시 탭으로 전환하면 코인 가격 표시

## 지원되는 코인

- Bitcoin (BTC)
- Ethereum (ETH)
- Ripple (XRP)
- Cardano (ADA)
- Solana (SOL)
- Dogecoin (DOGE)
- Polkadot (DOT)
- Binance Coin (BNB)
- Avalanche (AVAX)
- Chainlink (LINK)

## 코인 변경

1. 익스텐션 아이콘 클릭
2. 드롭다운에서 원하는 코인 선택
3. 즉시 적용됨
