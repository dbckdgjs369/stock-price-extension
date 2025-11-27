// 원래 페이지 타이틀 저장
let originalTitle = document.title;
let isShowingPrice = false;

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

// 타이틀 업데이트 함수
async function updateTitle(priceData) {
  if (!priceData) return;

  // 현재 타이틀이 가격이 아니면 원래 타이틀로 저장
  if (!isShowingPrice) {
    originalTitle = document.title;
  }

  // 선택된 통화 가져오기
  let selectedCurrency = "usd"; // 기본값
  try {
    const result = await chrome.storage.local.get("selectedCurrency");
    if (result.selectedCurrency) {
      selectedCurrency = result.selectedCurrency;
    }
  } catch (error) {
    console.log("통화 설정 로드 실패, 기본값(USD) 사용");
  }

  const price = selectedCurrency === "usd" ? priceData.usd : priceData.krw;
  const formattedPrice = formatPrice(price, selectedCurrency);

  // 타이틀 형식: 가격만 표시 (더 간결하게)
  document.title = formattedPrice;
  isShowingPrice = true;
}

// 원래 타이틀로 복구
function restoreTitle() {
  if (isShowingPrice && originalTitle) {
    document.title = originalTitle;
    isShowingPrice = false;
  }
}

// background script에서 메시지 받기
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "UPDATE_PRICE") {
    updateTitle(request.price);
  } else if (request.type === "RESTORE_TITLE") {
    restoreTitle();
  }
  return true;
});

// 페이지 로드 시 원래 타이틀 저장
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    originalTitle = document.title;
  });
} else {
  originalTitle = document.title;
}

// 페이지의 타이틀이 변경될 때 처리
const titleObserver = new MutationObserver(() => {
  // 가격을 표시하는 중인데 타이틀이 변경되면 다시 가격으로 업데이트
  if (isShowingPrice) {
    try {
      chrome.storage.local.get(["cryptoPrice"], (result) => {
        if (chrome.runtime.lastError) {
          // 익스텐션 컨텍스트가 무효화됨 - observer 중지
          console.log("Extension context invalidated, stopping observer");
          titleObserver.disconnect();
          return;
        }

        if (result.cryptoPrice) {
          // 가격 형식인지 확인 ($ 또는 ₩로 시작)
          if (
            !document.title.startsWith("$") &&
            !document.title.startsWith("₩")
          ) {
            // 페이지가 타이틀을 변경했으므로 새로운 원래 타이틀로 저장
            originalTitle = document.title;
            // 다시 가격으로 업데이트
            updateTitle(result.cryptoPrice);
          }
        }
      });
    } catch (error) {
      // 익스텐션이 업데이트되거나 비활성화됨
      console.log("Extension error, stopping observer:", error);
      titleObserver.disconnect();
    }
  } else {
    // 가격을 표시하지 않는 중이면 원래 타이틀 업데이트
    originalTitle = document.title;
  }
});

// title 태그 관찰 시작
const titleElement = document.querySelector("title");
if (titleElement) {
  titleObserver.observe(titleElement, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}
