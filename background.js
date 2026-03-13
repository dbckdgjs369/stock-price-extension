const STOCK_SYMBOL = "005930.KS";
const REFRESH_ALARM = "refresh-samsung-stock";
const REFRESH_MINUTES = 1;

async function fetchStockQuote() {
  const response = await fetch(
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
      STOCK_SYMBOL
    )}`
  );

  if (!response.ok) {
    throw new Error(`Quote request failed: ${response.status}`);
  }

  const payload = await response.json();
  const quote = payload?.quoteResponse?.result?.[0];

  if (!quote) {
    throw new Error("Quote payload did not include a result");
  }

  const stockData = {
    symbol: STOCK_SYMBOL,
    shortName: quote.shortName || "Samsung Electronics",
    price: quote.regularMarketPrice ?? null,
    change: quote.regularMarketChange ?? 0,
    changePercent: quote.regularMarketChangePercent ?? 0,
    currency: quote.currency || "KRW",
    marketState: quote.marketState || "UNKNOWN",
    exchangeName: quote.fullExchangeName || quote.exchange || "KRX",
    updatedAt: Date.now(),
  };

  await chrome.storage.local.set({ stockData, stockError: null });
  await broadcastPriceUpdate(stockData);

  return stockData;
}

async function broadcastPriceUpdate(stockData) {
  const tabs = await chrome.tabs.query({});

  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id && tab.url)
      .map((tab) =>
        chrome.tabs.sendMessage(tab.id, {
          type: "STOCK_DATA_UPDATED",
          stockData,
        })
      )
  );
}

async function refreshStockQuote() {
  try {
    return await fetchStockQuote();
  } catch (error) {
    const stockError = error instanceof Error ? error.message : String(error);
    await chrome.storage.local.set({ stockError });
    console.error("삼성전자 시세 갱신 실패:", error);
    return null;
  }
}

async function initializeDefaults() {
  const current = await chrome.storage.local.get([
    "widgetEnabled",
    "widgetBounds",
    "stockData",
  ]);

  const nextState = {};

  if (typeof current.widgetEnabled !== "boolean") {
    nextState.widgetEnabled = true;
  }

  if (!current.widgetBounds) {
    nextState.widgetBounds = {
      top: 96,
      left: 32,
      width: 220,
      height: 84,
    };
  }

  if (Object.keys(nextState).length > 0) {
    await chrome.storage.local.set(nextState);
  }
}

async function ensureRefreshAlarm() {
  await chrome.alarms.clear(REFRESH_ALARM);
  await chrome.alarms.create(REFRESH_ALARM, {
    periodInMinutes: REFRESH_MINUTES,
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await initializeDefaults();
  await ensureRefreshAlarm();
  await refreshStockQuote();
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeDefaults();
  await ensureRefreshAlarm();
  await refreshStockQuote();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) {
    refreshStockQuote();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_STOCK_DATA") {
    chrome.storage.local
      .get(["stockData", "stockError"])
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          stockData: null,
          stockError: error instanceof Error ? error.message : String(error),
        })
      );
    return true;
  }

  if (request.type === "REFRESH_STOCK_DATA") {
    refreshStockQuote()
      .then((stockData) => sendResponse({ stockData, ok: Boolean(stockData) }))
      .catch((error) =>
        sendResponse({
          stockData: null,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    return true;
  }

  return false;
});

refreshStockQuote();
