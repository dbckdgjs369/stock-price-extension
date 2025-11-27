// DOM 요소
const priceDisplay = document.getElementById("priceDisplay");
const cryptoSelect = document.getElementById("cryptoSelect");
const currencyToggle = document.getElementById("currencyToggle");
const toggleButton = document.getElementById("toggleButton");
const statusText = document.getElementById("statusText");

// 가격을 포맷팅하는 함수
function formatPrice(price, currency) {
  if (currency === "usd") {
    return `$${price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  } else if (currency === "krw") {
    return `₩${price.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}`;
  }
  return price.toString();
}

// 코인 이름을 표시용으로 변환
function getCryptoDisplayName(cryptoId) {
  const names = {
    bitcoin: "Bitcoin (BTC)",
    ethereum: "Ethereum (ETH)",
    ripple: "Ripple (XRP)",
    cardano: "Cardano (ADA)",
    solana: "Solana (SOL)",
    dogecoin: "Dogecoin (DOGE)",
    polkadot: "Polkadot (DOT)",
    binancecoin: "Binance Coin (BNB)",
    "avalanche-2": "Avalanche (AVAX)",
    chainlink: "Chainlink (LINK)",
  };
  return names[cryptoId] || cryptoId.toUpperCase();
}

// 가격 정보 표시
function displayPrice(priceData) {
  if (!priceData) {
    priceDisplay.innerHTML = '<div class="loading">가격 정보 없음</div>';
    return;
  }

  const displayName = getCryptoDisplayName(priceData.crypto);
  const usdPrice = formatPrice(priceData.usd, "usd");
  const krwPrice = formatPrice(priceData.krw, "krw");

  priceDisplay.innerHTML = `
    <h2>${displayName}</h2>
    <div class="price-value">${usdPrice}</div>
    <div class="price-krw">${krwPrice}</div>
  `;
}

// 통화 토글 스위치 업데이트
function updateCurrencyToggle(currency) {
  currencyToggle.setAttribute("data-currency", currency);
  const slider = currencyToggle.querySelector(".toggle-slider");
  slider.textContent = currency === "usd" ? "$" : "₩";
}

// 초기 설정 로드
chrome.storage.local.get(
  ["selectedCrypto", "selectedCurrency", "cryptoPrice"],
  (result) => {
    if (result.selectedCrypto) {
      cryptoSelect.value = result.selectedCrypto;
    }
    if (result.selectedCurrency) {
      updateCurrencyToggle(result.selectedCurrency);
    }
    if (result.cryptoPrice) {
      displayPrice(result.cryptoPrice);
    }
  }
);

// 코인 선택 변경 이벤트
cryptoSelect.addEventListener("change", async (e) => {
  const selectedCrypto = e.target.value;

  // storage에 저장
  await chrome.storage.local.set({ selectedCrypto });

  // 로딩 표시
  priceDisplay.innerHTML =
    '<div class="loading">가격 정보를 불러오는 중...</div>';

  // background script에 즉시 가격 업데이트 요청
  chrome.runtime.sendMessage({ type: "GET_PRICE" }, (response) => {
    if (response && response.price) {
      displayPrice(response.price);
    }
  });
});

// 통화 토글 버튼 클릭 이벤트
currencyToggle.addEventListener("click", async () => {
  // 현재 통화 가져오기
  const { selectedCurrency } = await chrome.storage.local.get(
    "selectedCurrency"
  );
  const currentCurrency = selectedCurrency || "usd";

  // 토글: USD ↔ KRW
  const newCurrency = currentCurrency === "usd" ? "krw" : "usd";

  // storage에 저장
  await chrome.storage.local.set({ selectedCurrency: newCurrency });

  // 토글 스위치 업데이트
  updateCurrencyToggle(newCurrency);

  // 현재 가격 정보로 다시 표시
  const { cryptoPrice } = await chrome.storage.local.get("cryptoPrice");
  if (cryptoPrice) {
    displayPrice(cryptoPrice);
  }

  // 대상 탭이 있으면 즉시 업데이트
  const { targetTabId } = await chrome.storage.local.get("targetTabId");
  if (targetTabId) {
    chrome.runtime.sendMessage({ type: "GET_PRICE" });
  }
});

// storage 변경 감지
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes.cryptoPrice) {
    displayPrice(changes.cryptoPrice.newValue);
  }
});

// 버튼 상태 업데이트
async function updateButtonState() {
  const [currentTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  const { targetTabId } = await chrome.storage.local.get("targetTabId");

  if (targetTabId === currentTab.id) {
    toggleButton.textContent = "가격 표시 중지";
    toggleButton.classList.add("active");
    statusText.textContent = "✓ 이 탭에 가격 표시 중";
  } else if (targetTabId) {
    toggleButton.textContent = "이 탭에 가격 표시";
    toggleButton.classList.remove("active");
    statusText.textContent = "다른 탭에서 표시 중";
  } else {
    toggleButton.textContent = "현재 탭에 가격 표시";
    toggleButton.classList.remove("active");
    statusText.textContent = "클릭하여 이 탭에 가격 표시";
  }
}

// content script 주입 및 메시지 전송
async function sendMessageToTab(tabId, message) {
  // 먼저 메시지 전송 시도
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return; // 성공하면 종료
  } catch (error) {
    // content script가 없으면 주입
    console.log("Content script 없음, 주입 시도...");
  }

  // content script 주입
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ["content.js"],
    });

    // 주입 후 짧은 대기 (스크립트 초기화 시간)
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 다시 메시지 전송
    await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    console.error("스크립트 주입 또는 메시지 전송 실패:", error);
    throw error;
  }
}

// 버튼 클릭 이벤트
toggleButton.addEventListener("click", async () => {
  const [currentTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  console.log("현재 탭 URL:", currentTab.url);

  // chrome:// 페이지나 익스텐션 페이지는 지원 안됨
  if (
    !currentTab.url ||
    currentTab.url.startsWith("chrome://") ||
    currentTab.url.startsWith("edge://") ||
    currentTab.url.startsWith("chrome-extension://") ||
    currentTab.url.startsWith("about:")
  ) {
    alert(
      `이 페이지에서는 사용할 수 없습니다.\n일반 웹 페이지에서만 사용 가능합니다.\n\n현재 페이지: ${
        currentTab.url || "알 수 없음"
      }`
    );
    return;
  }

  const { targetTabId } = await chrome.storage.local.get("targetTabId");

  if (targetTabId === currentTab.id) {
    // 현재 탭에서 표시 중이면 중지
    await chrome.storage.local.remove("targetTabId");
    try {
      await sendMessageToTab(currentTab.id, { type: "RESTORE_TITLE" });
    } catch (error) {
      console.error("타이틀 복구 실패:", error);
    }
  } else {
    // 이전 탭 타이틀 복구
    if (targetTabId) {
      try {
        await sendMessageToTab(targetTabId, { type: "RESTORE_TITLE" });
      } catch (error) {
        // 이전 탭이 닫혔을 수 있음
      }
    }

    // 새 탭에 설정
    await chrome.storage.local.set({ targetTabId: currentTab.id });

    // 현재 가격 전송
    const { cryptoPrice } = await chrome.storage.local.get("cryptoPrice");
    if (cryptoPrice) {
      try {
        await sendMessageToTab(currentTab.id, {
          type: "UPDATE_PRICE",
          price: cryptoPrice,
        });
      } catch (error) {
        console.error("가격 표시 실패:", error);
        alert(
          `이 페이지에서는 가격을 표시할 수 없습니다.\n다른 페이지를 선택해주세요.\n\n에러: ${error.message}`
        );
        await chrome.storage.local.remove("targetTabId");
        updateButtonState();
        return;
      }
    }
  }

  updateButtonState();
});

// 초기 버튼 상태 설정
updateButtonState();
