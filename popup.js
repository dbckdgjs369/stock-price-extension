const widgetToggle = document.getElementById("widgetToggle");
const refreshButton = document.getElementById("refreshButton");
const placeButton = document.getElementById("placeButton");
const statusLabel = document.getElementById("statusLabel");
const priceValue = document.getElementById("priceValue");
const moveHint = document.getElementById("moveHint");

function formatPrice(value) {
  if (typeof value !== "number") {
    return "--";
  }

  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatChange(change, changePercent) {
  if (typeof change !== "number" || typeof changePercent !== "number") {
    return "변동 정보 없음";
  }

  const direction = change > 0 ? "▲" : change < 0 ? "▼" : "•";
  return `${direction} ${Math.abs(change).toLocaleString("ko-KR")} / ${Math.abs(
    changePercent
  ).toFixed(2)}%`;
}

function renderQuote(stockData, stockError) {
  if (stockError) {
    priceValue.textContent = "시세 조회 실패";
    statusLabel.textContent = stockError;
    return;
  }

  if (!stockData) {
    priceValue.textContent = "--";
    statusLabel.textContent = "시세를 불러오는 중";
    return;
  }

  priceValue.textContent = formatPrice(stockData.price);
  statusLabel.textContent = formatChange(
    stockData.change,
    stockData.changePercent
  );
}

async function loadState() {
  const [{ widgetEnabled }, quote] = await Promise.all([
    chrome.storage.local.get("widgetEnabled"),
    chrome.runtime.sendMessage({ type: "GET_STOCK_DATA" }),
  ]);

  widgetToggle.checked =
    typeof widgetEnabled === "boolean" ? widgetEnabled : true;
  renderQuote(quote.stockData, quote.stockError);
}

widgetToggle.addEventListener("change", async (event) => {
  await chrome.storage.local.set({ widgetEnabled: event.target.checked });
});

placeButton.addEventListener("click", async () => {
  await chrome.storage.local.set({ placementMode: true, widgetEnabled: true });
  moveHint.textContent = "페이지로 돌아가서 한 번 드래그하면 새 위치가 적용됩니다.";
});

refreshButton.addEventListener("click", async () => {
  statusLabel.textContent = "새 시세 요청 중";
  const response = await chrome.runtime.sendMessage({ type: "REFRESH_STOCK_DATA" });
  renderQuote(response.stockData, response.error || null);
});

moveHint.textContent =
  "페이지에서 Shift + 드래그로 새 영역을 잡거나, Shift 누른 채 위젯을 끌어서 옮길 수 있습니다.";

loadState();
