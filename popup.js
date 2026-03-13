const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const searchModeButtons = document.querySelectorAll("[data-search-mode]");
const searchStatus = document.getElementById("searchStatus");
const searchResults = document.getElementById("searchResults");
const manualCreate = document.getElementById("manualCreate");
const pendingSection = document.getElementById("pendingSection");
const pendingLabel = document.getElementById("pendingLabel");
const clearPendingButton = document.getElementById("clearPendingButton");
const refreshButton = document.getElementById("refreshButton");
const widgetList = document.getElementById("widgetList");
const widgetEmpty = document.getElementById("widgetEmpty");

let popupState = {
  widgets: [],
  pendingWidgetDraft: null,
  quotesBySymbol: {},
  stockError: null,
};
let searchMode = "stock";

function normalizeManualEntry(query) {
  const trimmed = query.trim();
  if (searchMode !== "crypto") {
    return { symbol: trimmed, shortName: trimmed };
  }

  return {
    symbol: trimmed.includes("-") ? trimmed.toUpperCase() : `${trimmed.toUpperCase()}-USD`,
    shortName: trimmed.toUpperCase(),
  };
}

function updateSearchModeUI() {
  searchModeButtons.forEach((button) => {
    button.dataset.active = button.dataset.searchMode === searchMode ? "true" : "false";
  });
  searchInput.placeholder =
    searchMode === "crypto" ? "예: BTC, ETH, BTC-USD" : "예: 삼성전자, AAPL, TSLA";
}

function formatPrice(quote) {
  if (!quote || typeof quote.price !== "number") {
    return "--";
  }

  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: quote.currency || "USD",
    maximumFractionDigits: quote.currency === "KRW" ? 0 : 2,
  }).format(quote.price);
}

function formatWidgetSubtitle(widget) {
  const quote = popupState.quotesBySymbol[widget.symbol];
  if (!quote) {
    return widget.symbol;
  }

  return `${widget.symbol} · ${formatPrice(quote)}`;
}

function renderPending() {
  if (!popupState.pendingWidgetDraft) {
    pendingSection.hidden = true;
    return;
  }

  pendingSection.hidden = false;
  pendingLabel.textContent = `${popupState.pendingWidgetDraft.shortName} (${popupState.pendingWidgetDraft.symbol})`;
}

function renderWidgets() {
  widgetList.innerHTML = "";

  if (popupState.widgets.length === 0) {
    widgetEmpty.hidden = false;
    return;
  }

  widgetEmpty.hidden = true;

  for (const widget of popupState.widgets) {
    const item = document.createElement("div");
    item.className = "widget-item";
    item.innerHTML = `
      <div>
        <div class="widget-title">${widget.shortName}</div>
        <div class="widget-subtitle">${formatWidgetSubtitle(widget)}</div>
      </div>
      <button class="ghost-button" data-remove-id="${widget.id}">삭제</button>
    `;
    widgetList.appendChild(item);
  }
}

function renderSearchResults(results) {
  searchResults.innerHTML = "";
  manualCreate.innerHTML = "";

  if (results.length === 0) {
    searchStatus.textContent = "검색 결과가 없습니다.";
    return;
  }

  searchStatus.textContent = "";

  for (const result of results) {
    const item = document.createElement("div");
    item.className = "result-item";
    item.innerHTML = `
      <div>
        <div class="result-title">${result.shortName}</div>
        <div class="result-subtitle">${result.symbol}${result.exchange ? ` · ${result.exchange}` : ""}</div>
      </div>
      <button class="action-button" data-symbol="${result.symbol}" data-name="${encodeURIComponent(
      result.shortName
    )}">생성</button>
    `;
    searchResults.appendChild(item);
  }
}

function renderManualCreate(query, message) {
  const trimmed = query.trim();
  manualCreate.innerHTML = "";

  if (!trimmed) {
    return;
  }

  if (message) {
    searchStatus.textContent = message;
  }

  const manualEntry = normalizeManualEntry(trimmed);

  const item = document.createElement("div");
  item.className = "result-item";
  item.innerHTML = `
    <div>
      <div class="result-title">${manualEntry.shortName}</div>
      <div class="result-subtitle">${manualEntry.symbol} · 검색 없이 입력값으로 바로 생성</div>
    </div>
    <button class="action-button" data-symbol="${manualEntry.symbol}" data-name="${encodeURIComponent(
    manualEntry.shortName
  )}">생성</button>
  `;
  manualCreate.appendChild(item);
}

async function loadState() {
  popupState = await chrome.runtime.sendMessage({ type: "GET_POPUP_STATE" });
  searchStatus.textContent = popupState.stockError || "";
  updateSearchModeUI();
  renderPending();
  renderWidgets();
}

searchModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    searchMode = button.dataset.searchMode || "stock";
    updateSearchModeUI();
    searchResults.innerHTML = "";
    manualCreate.innerHTML = "";
    searchStatus.textContent = "";
  });
});

async function ensureContentScriptOnActiveTab() {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (
    !activeTab?.id ||
    !activeTab.url ||
    activeTab.url.startsWith("chrome://") ||
    activeTab.url.startsWith("edge://") ||
    activeTab.url.startsWith("chrome-extension://") ||
    activeTab.url.startsWith("about:")
  ) {
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ["content.js"],
    });
  } catch (error) {
    console.error("content script 주입 실패:", error);
  }
}

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const query = searchInput.value.trim();
  if (!query) {
    searchStatus.textContent = "종목명이나 티커를 입력하세요.";
    searchResults.innerHTML = "";
    manualCreate.innerHTML = "";
    return;
  }

  searchStatus.textContent = "검색 중...";
  searchResults.innerHTML = "";
  renderManualCreate(query);

  const response = await chrome.runtime.sendMessage({
    type: "SEARCH_SYMBOLS",
    query,
    mode: searchMode,
  });

  if (response.error) {
    renderManualCreate(query, `${response.error} · 입력값으로 바로 생성할 수 있습니다.`);
    return;
  }

  renderSearchResults(response.results || []);
  renderManualCreate(query);
});

async function handleCreateButtonClick(event) {
  const button = event.target.closest("button[data-symbol]");
  if (!button) {
    return;
  }

  await chrome.runtime.sendMessage({
    type: "SET_PENDING_WIDGET",
    widget: {
      symbol: button.dataset.symbol,
      shortName: decodeURIComponent(button.dataset.name),
    },
  });

  popupState.pendingWidgetDraft = {
    symbol: button.dataset.symbol,
    shortName: decodeURIComponent(button.dataset.name),
  };
  await ensureContentScriptOnActiveTab();
  renderPending();
  searchStatus.textContent = "페이지로 가서 Shift + 드래그하면 위젯이 생성됩니다.";
}

searchResults.addEventListener("click", handleCreateButtonClick);
manualCreate.addEventListener("click", handleCreateButtonClick);

clearPendingButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({
    type: "SET_PENDING_WIDGET",
    widget: null,
  });
  popupState.pendingWidgetDraft = null;
  renderPending();
});

widgetList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-remove-id]");
  if (!button) {
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "REMOVE_WIDGET",
    widgetId: button.dataset.removeId,
  });

  if (response.ok) {
    popupState.widgets = response.widgets || [];
    renderWidgets();
  }
});

refreshButton.addEventListener("click", async () => {
  searchStatus.textContent = "시세 새로고침 중...";
  const response = await chrome.runtime.sendMessage({ type: "REFRESH_QUOTES" });
  popupState.quotesBySymbol = response.quotesBySymbol || {};
  renderWidgets();
  searchStatus.textContent = response.ok ? "시세를 갱신했습니다." : response.error || "갱신 실패";
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes.widgets) {
    popupState.widgets = changes.widgets.newValue || [];
    renderWidgets();
  }

  if (changes.pendingWidgetDraft) {
    popupState.pendingWidgetDraft = changes.pendingWidgetDraft.newValue || null;
    renderPending();
  }

  if (changes.quotesBySymbol) {
    popupState.quotesBySymbol = changes.quotesBySymbol.newValue || {};
    renderWidgets();
  }

  if (changes.stockError) {
    searchStatus.textContent = changes.stockError.newValue || "";
  }
});

loadState();
