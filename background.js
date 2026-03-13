const REFRESH_ALARM = "refresh-stock-widgets";
const REFRESH_MINUTES = 1;

function normalizeQuote(quote) {
  return {
    symbol: quote.symbol,
    shortName: quote.shortName || quote.longName || quote.symbol,
    price: quote.regularMarketPrice ?? null,
    change: quote.regularMarketChange ?? 0,
    changePercent: quote.regularMarketChangePercent ?? 0,
    currency: quote.currency || "USD",
    marketState: quote.marketState || "UNKNOWN",
    exchangeName: quote.fullExchangeName || quote.exchange || "",
    updatedAt: Date.now(),
  };
}

async function fetchQuotes(symbols) {
  if (symbols.length === 0) {
    return {};
  }

  const response = await fetch(
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
      symbols.join(",")
    )}`
  );

  if (!response.ok) {
    throw new Error(`Quote request failed: ${response.status}`);
  }

  const payload = await response.json();
  const results = payload?.quoteResponse?.result || [];

  return Object.fromEntries(
    results.filter((quote) => quote?.symbol).map((quote) => [quote.symbol, normalizeQuote(quote)])
  );
}

async function searchSymbols(query, mode = "stock") {
  const response = await fetch(
    `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
      query
    )}&quotesCount=8&newsCount=0&enableFuzzyQuery=false`
  );

  if (!response.ok) {
    throw new Error(`Search request failed: ${response.status}`);
  }

  const payload = await response.json();
  const quotes = payload?.quotes || [];
  const seen = new Set();
  const allowedTypes =
    mode === "crypto" ? new Set(["CRYPTOCURRENCY"]) : new Set(["EQUITY", "ETF"]);

  return quotes.reduce((results, quote) => {
    const quoteType = quote.quoteType || quote.typeDisp;

    if (
      !quote.symbol ||
      seen.has(quote.symbol) ||
      !allowedTypes.has(quoteType)
    ) {
      return results;
    }

    seen.add(quote.symbol);
    results.push({
      symbol: quote.symbol,
      shortName: quote.shortname || quote.longname || quote.symbol,
      exchange: quote.exchDisp || quote.exchange || "",
      type: quote.quoteType || quote.typeDisp || "",
    });
    return results;
  }, []);
}

async function broadcastQuotesUpdated(quotesBySymbol) {
  const tabs = await chrome.tabs.query({});

  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id && tab.url)
      .map((tab) =>
        chrome.tabs.sendMessage(tab.id, {
          type: "QUOTES_UPDATED",
          quotesBySymbol,
        })
      )
  );
}

async function refreshQuotes() {
  try {
    const { widgets = [] } = await chrome.storage.local.get("widgets");
    const symbols = [...new Set(widgets.map((widget) => widget.symbol).filter(Boolean))];
    const quotesBySymbol = await fetchQuotes(symbols);

    await chrome.storage.local.set({
      quotesBySymbol,
      stockError: null,
      lastRefreshAt: Date.now(),
    });
    await broadcastQuotesUpdated(quotesBySymbol);

    return quotesBySymbol;
  } catch (error) {
    const stockError = error instanceof Error ? error.message : String(error);
    await chrome.storage.local.set({ stockError });
    console.error("주가 갱신 실패:", error);
    return {};
  }
}

async function initializeDefaults() {
  const current = await chrome.storage.local.get([
    "widgets",
    "pendingWidgetDraft",
    "quotesBySymbol",
  ]);
  const nextState = {};

  if (!Array.isArray(current.widgets)) {
    nextState.widgets = [];
  }

  if (typeof current.pendingWidgetDraft === "undefined") {
    nextState.pendingWidgetDraft = null;
  }

  if (!current.quotesBySymbol || typeof current.quotesBySymbol !== "object") {
    nextState.quotesBySymbol = {};
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
  await refreshQuotes();
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeDefaults();
  await ensureRefreshAlarm();
  await refreshQuotes();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.widgets) {
    refreshQuotes();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) {
    refreshQuotes();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_POPUP_STATE") {
    chrome.storage.local
      .get(["widgets", "pendingWidgetDraft", "quotesBySymbol", "stockError"])
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          widgets: [],
          pendingWidgetDraft: null,
          quotesBySymbol: {},
          stockError: error instanceof Error ? error.message : String(error),
        })
      );
    return true;
  }

  if (request.type === "SEARCH_SYMBOLS") {
    searchSymbols(request.query || "", request.mode || "stock")
      .then((results) => sendResponse({ results }))
      .catch((error) =>
        sendResponse({
          results: [],
          error: error instanceof Error ? error.message : String(error),
        })
      );
    return true;
  }

  if (request.type === "SET_PENDING_WIDGET") {
    chrome.storage.local
      .set({ pendingWidgetDraft: request.widget || null })
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    return true;
  }

  if (request.type === "REMOVE_WIDGET") {
    chrome.storage.local
      .get("widgets")
      .then(async ({ widgets = [] }) => {
        const nextWidgets = widgets.filter((widget) => widget.id !== request.widgetId);
        await chrome.storage.local.set({ widgets: nextWidgets });
        sendResponse({ ok: true, widgets: nextWidgets });
      })
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    return true;
  }

  if (request.type === "REFRESH_QUOTES") {
    refreshQuotes()
      .then((quotesBySymbol) => sendResponse({ ok: true, quotesBySymbol }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    return true;
  }

  return false;
});

refreshQuotes();
