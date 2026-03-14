try {
  importScripts("gate-config.local.js");
} catch (error) {
  // Local Gate.io credentials are optional during development.
}

const REFRESH_ALARM = "refresh-stock-widgets";
const REFRESH_MINUTES = 1;
const FOREGROUND_REFRESH_MS = 15 * 1000;
const GATE_API_BASE_URL = "https://api.gateio.ws/api/v4";
const GATE_TICKER_CACHE_MS = 30 * 1000;
const GATE_PAIR_CACHE_MS = 10 * 60 * 1000;
const PREFERRED_GATE_QUOTES = ["USDT", "USDC"];
let gateTickerCache = {
  expiresAt: 0,
  data: new Map(),
};
let gatePairCache = {
  expiresAt: 0,
  data: [],
};
let foregroundRefreshTimer = null;

function isCryptoSymbol(symbol) {
  return /^[A-Z0-9]+-(USD|USDT|USDC)$/i.test(symbol);
}

function toGateCurrencyPair(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  const [base, quote] = normalized.split("-");

  if (!base || !quote) {
    return null;
  }

  if (quote === "USD") {
    return null;
  }

  return `${base}_${quote}`;
}

function buildPublicHeaders() {
  return {
    Accept: "application/json",
  };
}

function toWidgetCryptoSymbol(currencyPair) {
  const normalized = String(currencyPair || "").trim().toUpperCase();
  const [base, quote] = normalized.split("_");

  if (!base || !quote) {
    return null;
  }

  return `${base}-${quote}`;
}

function splitGateCurrencyPair(currencyPair) {
  const normalized = String(currencyPair || "").trim().toUpperCase();
  const [base, quote] = normalized.split("_");

  if (!base || !quote) {
    return null;
  }

  return { base, quote };
}

function resolveGateCurrencyPair(symbol, availablePairs) {
  const normalized = String(symbol || "").trim().toUpperCase();
  const [base, quote] = normalized.split("-");

  if (!base) {
    return null;
  }

  const exactPair = toGateCurrencyPair(normalized);
  if (exactPair && availablePairs.has(exactPair)) {
    return exactPair;
  }

  if (quote === "USD") {
    for (const preferredQuote of PREFERRED_GATE_QUOTES) {
      const candidate = `${base}_${preferredQuote}`;
      if (availablePairs.has(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

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

function normalizeGateQuote(symbol, ticker) {
  const price = Number(ticker?.last);
  const changePercent = Number(ticker?.change_percentage ?? 0);
  const change = price * (changePercent / 100);

  return {
    symbol,
    shortName: symbol,
    price: Number.isFinite(price) ? price : null,
    change: Number.isFinite(change) ? change : 0,
    changePercent: Number.isFinite(changePercent) ? changePercent : 0,
    currency: "USD",
    marketState: "TRADING",
    exchangeName: "Gate.io",
    updatedAt: Date.now(),
  };
}

async function fetchStockQuotes(symbols) {
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

async function getGateTickers() {
  if (gateTickerCache.expiresAt > Date.now()) {
    return gateTickerCache.data;
  }

  const response = await fetch(`${GATE_API_BASE_URL}/spot/tickers`, {
    headers: buildPublicHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Gate ticker request failed: ${response.status}`);
  }

  const payload = await response.json();
  const data = new Map(
    (Array.isArray(payload) ? payload : [])
      .filter((ticker) => ticker?.currency_pair)
      .map((ticker) => [String(ticker.currency_pair).toUpperCase(), ticker])
  );

  gateTickerCache = {
    expiresAt: Date.now() + GATE_TICKER_CACHE_MS,
    data,
  };

  return data;
}

async function getGateCurrencyPairs() {
  if (gatePairCache.expiresAt > Date.now()) {
    return gatePairCache.data;
  }

  const response = await fetch(`${GATE_API_BASE_URL}/spot/currency_pairs`, {
    headers: buildPublicHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Gate pair request failed: ${response.status}`);
  }

  const payload = await response.json();
  const data = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.currency_pairs)
      ? payload.currency_pairs
      : [];

  gatePairCache = {
    expiresAt: Date.now() + GATE_PAIR_CACHE_MS,
    data,
  };

  return data;
}

async function fetchCryptoQuotes(symbols) {
  if (symbols.length === 0) {
    return {};
  }

  const tickers = await getGateTickers();
  const availablePairs = new Set(tickers.keys());
  const entries = symbols.map((symbol) => {
    const currencyPair = resolveGateCurrencyPair(symbol, availablePairs);
    const ticker = currencyPair ? tickers.get(currencyPair) || null : null;
    return [symbol, ticker ? normalizeGateQuote(symbol, ticker) : null];
  });

  return Object.fromEntries(entries.filter(([, quote]) => quote));
}

async function fetchQuotes(symbols) {
  if (symbols.length === 0) {
    return {};
  }

  const stockSymbols = symbols.filter((symbol) => !isCryptoSymbol(symbol));
  const cryptoSymbols = symbols.filter((symbol) => isCryptoSymbol(symbol));
  const [stockQuotesResult, cryptoQuotesResult] = await Promise.allSettled([
    fetchStockQuotes(stockSymbols),
    fetchCryptoQuotes(cryptoSymbols),
  ]);

  const stockQuotes =
    stockQuotesResult.status === "fulfilled" ? stockQuotesResult.value : {};
  const cryptoQuotes =
    cryptoQuotesResult.status === "fulfilled" ? cryptoQuotesResult.value : {};

  if (stockQuotesResult.status === "rejected") {
    console.error("주식 시세 갱신 실패:", stockQuotesResult.reason);
  }

  if (cryptoQuotesResult.status === "rejected") {
    console.error("코인 시세 갱신 실패:", cryptoQuotesResult.reason);
  }

  return {
    ...stockQuotes,
    ...cryptoQuotes,
  };
}

async function searchSymbols(query, mode = "stock") {
  if (mode === "crypto") {
    const normalizedQuery = String(query || "").trim().toUpperCase();

    if (!normalizedQuery) {
      return [];
    }

    const pairs = await getGateCurrencyPairs();

    return pairs
      .filter((pair) => {
        const currencyPair = String(pair?.id || pair?.currency_pair || pair || "").toUpperCase();
        const splitPair = splitGateCurrencyPair(currencyPair);

        if (!splitPair) {
          return false;
        }

        const widgetSymbol = toWidgetCryptoSymbol(currencyPair) || "";

        return (
          PREFERRED_GATE_QUOTES.includes(splitPair.quote) &&
          (currencyPair.includes(normalizedQuery) ||
            splitPair.base.includes(normalizedQuery) ||
            widgetSymbol.includes(normalizedQuery))
        );
      })
      .sort((leftPair, rightPair) => {
        const leftCurrencyPair = String(
          leftPair?.id || leftPair?.currency_pair || leftPair || ""
        ).toUpperCase();
        const rightCurrencyPair = String(
          rightPair?.id || rightPair?.currency_pair || rightPair || ""
        ).toUpperCase();
        const leftSplitPair = splitGateCurrencyPair(leftCurrencyPair);
        const rightSplitPair = splitGateCurrencyPair(rightCurrencyPair);
        const leftExactBase = leftSplitPair?.base === normalizedQuery ? 0 : 1;
        const rightExactBase = rightSplitPair?.base === normalizedQuery ? 0 : 1;
        const leftQuoteRank = PREFERRED_GATE_QUOTES.indexOf(leftSplitPair?.quote || "");
        const rightQuoteRank = PREFERRED_GATE_QUOTES.indexOf(rightSplitPair?.quote || "");
        const normalizedLeftRank = leftQuoteRank === -1 ? Number.MAX_SAFE_INTEGER : leftQuoteRank;
        const normalizedRightRank =
          rightQuoteRank === -1 ? Number.MAX_SAFE_INTEGER : rightQuoteRank;

        if (leftExactBase !== rightExactBase) {
          return leftExactBase - rightExactBase;
        }

        if (normalizedLeftRank !== normalizedRightRank) {
          return normalizedLeftRank - normalizedRightRank;
        }

        return leftCurrencyPair.localeCompare(rightCurrencyPair);
      })
      .slice(0, 8)
      .map((pair) => {
        const currencyPair = String(pair?.id || pair?.currency_pair || pair || "").toUpperCase();
        const splitPair = splitGateCurrencyPair(currencyPair);

        if (!splitPair) {
          return null;
        }

        const symbol = toWidgetCryptoSymbol(currencyPair) || `${splitPair.base}-USD`;

        return {
          symbol,
          shortName: `${splitPair.base}/${splitPair.quote}`,
          exchange: "Gate.io",
          type: "CRYPTOCURRENCY",
        };
      })
      .filter(Boolean)
      .filter((result, index, results) => {
        return results.findIndex((item) => item.symbol === result.symbol) === index;
      });
  }

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

function scheduleForegroundRefresh() {
  if (foregroundRefreshTimer) {
    clearTimeout(foregroundRefreshTimer);
  }

  foregroundRefreshTimer = setTimeout(async () => {
    foregroundRefreshTimer = null;

    try {
      const tabs = await chrome.tabs.query({});
      const hasUsableTab = tabs.some(
        (tab) =>
          tab.url &&
          !tab.url.startsWith("chrome://") &&
          !tab.url.startsWith("edge://") &&
          !tab.url.startsWith("chrome-extension://") &&
          !tab.url.startsWith("about:")
      );

      if (!hasUsableTab) {
        scheduleForegroundRefresh();
        return;
      }

      await refreshQuotes();
    } finally {
      scheduleForegroundRefresh();
    }
  }, FOREGROUND_REFRESH_MS);
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
  scheduleForegroundRefresh();
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeDefaults();
  await ensureRefreshAlarm();
  await refreshQuotes();
  scheduleForegroundRefresh();
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

  if (request.type === "GET_GATE_CURRENCY_PAIRS") {
    getGateCurrencyPairs()
      .then((pairs) => sendResponse({ pairs }))
      .catch((error) =>
        sendResponse({
          pairs: [],
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
scheduleForegroundRefresh();
