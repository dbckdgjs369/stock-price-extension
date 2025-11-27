// 코인 가격 정보를 저장할 변수
let cryptoPrice = null;
let selectedCrypto = "bitcoin"; // 기본값: 비트코인

// CoinGecko API에서 코인 가격 가져오기
async function fetchCryptoPrice() {
  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${selectedCrypto}&vs_currencies=usd,krw`
    );
    const data = await response.json();

    if (data[selectedCrypto]) {
      cryptoPrice = {
        crypto: selectedCrypto,
        usd: data[selectedCrypto].usd,
        krw: data[selectedCrypto].krw,
        timestamp: Date.now(),
      };

      // storage에 저장
      await chrome.storage.local.set({ cryptoPrice });

      // 대상 탭에만 가격 업데이트 메시지 전송
      await updateTargetTabTitle();
    }
  } catch (error) {
    console.error("가격 가져오기 실패:", error);
  }
}

// 대상 탭의 타이틀 업데이트
async function updateTargetTabTitle() {
  try {
    const { targetTabId } = await chrome.storage.local.get("targetTabId");

    if (targetTabId && cryptoPrice) {
      chrome.tabs
        .sendMessage(targetTabId, {
          type: "UPDATE_PRICE",
          price: cryptoPrice,
        })
        .catch(() => {
          // content script가 로드되지 않았을 수 있음
        });
    }
  } catch (error) {
    console.error("대상 탭 업데이트 실패:", error);
  }
}

// 모든 탭에 content script 주입
async function injectContentScriptToAllTabs() {
  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    // chrome:// 이나 edge:// 같은 내부 페이지는 스킵
    if (
      tab.url &&
      !tab.url.startsWith("chrome://") &&
      !tab.url.startsWith("edge://") &&
      !tab.url.startsWith("chrome-extension://")
    ) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        });
      } catch (error) {
        // 일부 탭은 권한이 없을 수 있음 (무시)
        console.log(`탭 ${tab.id}에 스크립트 주입 실패:`, error.message);
      }
    }
  }
}

// 초기화
chrome.runtime.onInstalled.addListener(async () => {
  // 기본 설정 저장
  await chrome.storage.local.set({
    selectedCrypto: "bitcoin",
    selectedCurrency: "usd", // 기본 통화: 달러
    updateInterval: 10, // 10초마다 업데이트
  });

  // 모든 기존 탭에 content script 주입 (새로고침 없이 바로 적용)
  await injectContentScriptToAllTabs();

  // 스크립트 주입 후 가격 가져오기 (활성 탭에 자동 전송)
  await fetchCryptoPrice();
});

// 10초마다 가격 업데이트 (setInterval 사용)
setInterval(() => {
  fetchCryptoPrice();
}, 10000); // 10초 = 10000ms

// storage 변경 감지 (설정 변경 시)
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes.selectedCrypto) {
    selectedCrypto = changes.selectedCrypto.newValue;
    fetchCryptoPrice(); // 즉시 새 코인 가격 가져오기
  }
});

// 메시지 리스너
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_PRICE") {
    sendResponse({ price: cryptoPrice });
  }
  return true;
});

// 서비스 워커 시작 시 가격 가져오기
fetchCryptoPrice();
