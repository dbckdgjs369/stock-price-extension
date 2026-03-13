const ROOT_ID = "samsung-stock-widget-root";
const STYLE_ID = "samsung-stock-widget-style";

let widgetRoot = null;
let widgetCard = null;
let selectionBox = null;
let selectionState = null;
let stockDataCache = null;
let widgetEnabled = true;
let widgetBounds = null;
let widgetTheme = null;
let placementMode = false;
let dragState = null;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${ROOT_ID} {
      position: absolute;
      z-index: 2147483646;
      pointer-events: none;
    }

    #${ROOT_ID}[data-hidden="true"] {
      display: none;
    }

    #${ROOT_ID} .stock-widget-card {
      width: 100%;
      height: 100%;
      pointer-events: auto;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      align-items: center;
      padding: 12px 14px;
      border-radius: 12px;
      color: var(--stock-color, rgba(17, 24, 39, 0.92));
      background: transparent;
      border: none;
      box-shadow: none;
      backdrop-filter: var(--stock-backdrop, none);
      font-family: var(--stock-font-family, inherit);
      letter-spacing: normal;
      overflow: hidden;
    }

    #${ROOT_ID} .stock-widget-card::before {
      content: "";
      position: absolute;
      inset: 0;
      background: none;
      pointer-events: none;
    }

    #${ROOT_ID} .stock-main,
    #${ROOT_ID} .stock-side {
      position: relative;
      z-index: 1;
    }

    #${ROOT_ID} .stock-label {
      font-size: 11px;
      text-transform: uppercase;
      color: var(--stock-muted, rgba(71, 85, 105, 0.76));
      margin-bottom: 3px;
    }

    #${ROOT_ID} .stock-price {
      font-size: 24px;
      line-height: 1;
      font-weight: 700;
    }

    #${ROOT_ID} .stock-name {
      font-size: 12px;
      color: var(--stock-muted, rgba(51, 65, 85, 0.84));
      margin-top: 5px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    #${ROOT_ID} .stock-change {
      font-size: 12px;
      font-weight: 700;
      text-align: right;
      white-space: nowrap;
      color: var(--stock-strong, var(--stock-color, rgba(17, 24, 39, 0.92)));
    }

    #${ROOT_ID} .stock-change[data-trend="up"] {
      color: var(--stock-up, var(--stock-strong, rgba(17, 24, 39, 0.92)));
    }

    #${ROOT_ID} .stock-change[data-trend="down"] {
      color: var(--stock-down, var(--stock-strong, rgba(17, 24, 39, 0.92)));
    }

    #${ROOT_ID} .stock-change[data-trend="flat"] {
      color: var(--stock-muted, rgba(71, 85, 105, 0.78));
    }

    #${ROOT_ID} .stock-meta {
      margin-top: 6px;
      font-size: 11px;
      text-align: right;
      color: var(--stock-muted, rgba(71, 85, 105, 0.78));
    }

    .stock-widget-selection {
      position: absolute;
      z-index: 2147483647;
      pointer-events: none;
      border-radius: 14px;
      border: none;
      background: rgba(148, 163, 184, 0.12);
      box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.14);
    }
  `;

  document.documentElement.appendChild(style);
}

function ensureRoot() {
  if (widgetRoot?.isConnected) {
    return widgetRoot;
  }

  widgetRoot = document.createElement("div");
  widgetRoot.id = ROOT_ID;
  widgetRoot.dataset.hidden = "true";

  widgetCard = document.createElement("div");
  widgetCard.className = "stock-widget-card";
  widgetRoot.appendChild(widgetCard);

  document.documentElement.appendChild(widgetRoot);
  return widgetRoot;
}

function withAlpha(color, alpha) {
  if (!color || color === "transparent") {
    return `rgba(255, 255, 255, ${alpha})`;
  }

  const match = color.match(/\d+(\.\d+)?/g);
  if (!match || match.length < 3) {
    return color;
  }

  const [r, g, b] = match;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function parseColor(color) {
  if (!color) {
    return null;
  }

  const match = color.match(/\d+(\.\d+)?/g);
  if (!match || match.length < 3) {
    return null;
  }

  return {
    r: Number(match[0]),
    g: Number(match[1]),
    b: Number(match[2]),
    a: match[3] ? Number(match[3]) : 1,
  };
}

function getRelativeLuminance(color) {
  const parsed = parseColor(color);
  if (!parsed) {
    return 1;
  }

  const toLinear = (channel) => {
    const value = channel / 255;
    return value <= 0.03928
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  };

  return (
    0.2126 * toLinear(parsed.r) +
    0.7152 * toLinear(parsed.g) +
    0.0722 * toLinear(parsed.b)
  );
}

function getContrastRatio(foreground, background) {
  const foregroundLum = getRelativeLuminance(foreground);
  const backgroundLum = getRelativeLuminance(background);
  const lighter = Math.max(foregroundLum, backgroundLum);
  const darker = Math.min(foregroundLum, backgroundLum);
  return (lighter + 0.05) / (darker + 0.05);
}

function pickReadableTextColor(preferredColor, backgroundColor) {
  const darkCandidate = "rgb(15, 23, 42)";
  const lightCandidate = "rgb(248, 250, 252)";

  if (getContrastRatio(preferredColor, backgroundColor) >= 4.5) {
    return preferredColor;
  }

  const darkContrast = getContrastRatio(darkCandidate, backgroundColor);
  const lightContrast = getContrastRatio(lightCandidate, backgroundColor);

  return darkContrast >= lightContrast ? darkCandidate : lightCandidate;
}

function sampleTheme(bounds) {
  const centerX = Math.max(
    0,
    Math.min(window.innerWidth - 1, bounds.left - window.scrollX + bounds.width / 2)
  );
  const centerY = Math.max(
    0,
    Math.min(window.innerHeight - 1, bounds.top - window.scrollY + bounds.height / 2)
  );

  const previousPointerEvents = widgetRoot?.style.pointerEvents || "";
  if (widgetRoot) {
    widgetRoot.style.pointerEvents = "none";
  }

  const sampleElement = document.elementFromPoint(centerX, centerY);

  if (widgetRoot) {
    widgetRoot.style.pointerEvents = previousPointerEvents;
  }

  const baseElement =
    sampleElement?.closest("button, a, section, article, aside, nav, div, li, p") ||
    sampleElement ||
    document.body;
  const computed = window.getComputedStyle(baseElement);
  const bodyStyle = window.getComputedStyle(document.body);
  const rootStyle = window.getComputedStyle(document.documentElement);

  const backgroundColor =
    computed.backgroundColor && computed.backgroundColor !== "rgba(0, 0, 0, 0)"
      ? computed.backgroundColor
      : bodyStyle.backgroundColor && bodyStyle.backgroundColor !== "rgba(0, 0, 0, 0)"
        ? bodyStyle.backgroundColor
        : rootStyle.backgroundColor;

  const preferredTextColor = computed.color || bodyStyle.color;
  const textColor = pickReadableTextColor(preferredTextColor, backgroundColor);
  const mutedColor = withAlpha(textColor, 0.72);
  const strongColor = withAlpha(textColor, 0.92);
  const borderColor =
    computed.borderColor && computed.borderColor !== "rgba(0, 0, 0, 0)"
      ? withAlpha(computed.borderColor, 0.38)
      : withAlpha(textColor, 0.14);
  const radius = computed.borderRadius && computed.borderRadius !== "0px"
    ? computed.borderRadius
    : "12px";

  return {
    backgroundColor,
    borderColor,
    textColor,
    mutedColor,
    strongColor,
    radius,
    fontFamily: computed.fontFamily || bodyStyle.fontFamily,
    backdrop: "none",
    overlay: "none",
  };
}

function applyTheme() {
  if (!widgetCard) {
    return;
  }

  const nextTheme = widgetTheme || sampleTheme(widgetBounds);
  widgetTheme = nextTheme;

  widgetCard.style.setProperty("--stock-color", nextTheme.textColor);
  widgetCard.style.setProperty("--stock-strong", nextTheme.strongColor);
  widgetCard.style.setProperty("--stock-font-family", nextTheme.fontFamily);
  widgetCard.style.setProperty("--stock-backdrop", nextTheme.backdrop);
  widgetCard.style.setProperty("--stock-overlay", nextTheme.overlay);
  widgetCard.style.setProperty("--stock-muted", nextTheme.mutedColor);
  widgetCard.style.borderRadius = nextTheme.radius;
}

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

function formatChange(value) {
  const absValue = Math.abs(value);
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
    signDisplay: "never",
  }).format(absValue);
}

function formatPercent(value) {
  const absValue = Math.abs(value);
  return `${absValue.toFixed(2)}%`;
}

function getTrend(change) {
  if (change > 0) {
    return "up";
  }
  if (change < 0) {
    return "down";
  }
  return "flat";
}

function getTrendPrefix(change) {
  if (change > 0) {
    return "▲";
  }
  if (change < 0) {
    return "▼";
  }
  return "•";
}

function formatUpdatedAt(timestamp) {
  if (!timestamp) {
    return "업데이트 정보 없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

function renderWidget() {
  ensureRoot();

  if (!widgetEnabled || !widgetBounds) {
    widgetRoot.dataset.hidden = "true";
    return;
  }

  widgetRoot.dataset.hidden = "false";
  widgetRoot.style.top = `${widgetBounds.top}px`;
  widgetRoot.style.left = `${widgetBounds.left}px`;
  widgetRoot.style.width = `${widgetBounds.width}px`;
  widgetRoot.style.height = `${widgetBounds.height}px`;
  applyTheme();

  if (!stockDataCache?.price) {
    widgetCard.innerHTML = `
      <div class="stock-main">
        <div class="stock-label">Samsung Electronics</div>
        <div class="stock-price">--</div>
        <div class="stock-name">시세를 불러오는 중</div>
      </div>
      <div class="stock-side">
        <div class="stock-change" data-trend="flat">• 대기 중</div>
        <div class="stock-meta">Shift + 드래그 또는 Shift + 클릭 후 이동</div>
      </div>
    `;
    return;
  }

  const trend = getTrend(stockDataCache.change);
  const prefix = getTrendPrefix(stockDataCache.change);

  widgetCard.innerHTML = `
    <div class="stock-main">
      <div class="stock-label">Samsung Electronics</div>
      <div class="stock-price">${formatPrice(stockDataCache.price)}</div>
      <div class="stock-name">${stockDataCache.shortName}</div>
    </div>
    <div class="stock-side">
      <div class="stock-change" data-trend="${trend}">
        ${prefix} ${formatChange(stockDataCache.change)} (${formatPercent(
    stockDataCache.changePercent
  )})
      </div>
      <div class="stock-meta">${formatUpdatedAt(stockDataCache.updatedAt)}</div>
    </div>
  `;
}

async function loadState() {
  const stored = await chrome.storage.local.get([
    "placementMode",
    "widgetEnabled",
    "widgetBounds",
    "stockData",
  ]);

  widgetEnabled =
    typeof stored.widgetEnabled === "boolean" ? stored.widgetEnabled : true;
  placementMode = Boolean(stored.placementMode);
  widgetBounds = stored.widgetBounds || {
    top: 96,
    left: 32,
    width: 220,
    height: 84,
  };
  stockDataCache = stored.stockData || null;

  renderWidget();
}

function clearSelectionBox() {
  if (selectionBox?.isConnected) {
    selectionBox.remove();
  }
  selectionBox = null;
}

function updateSelectionBox(bounds) {
  if (!selectionBox) {
    selectionBox = document.createElement("div");
    selectionBox.className = "stock-widget-selection";
    document.documentElement.appendChild(selectionBox);
  }

  selectionBox.style.left = `${bounds.left}px`;
  selectionBox.style.top = `${bounds.top}px`;
  selectionBox.style.width = `${bounds.width}px`;
  selectionBox.style.height = `${bounds.height}px`;
}

function normalizeSelection(startX, startY, endX, endY) {
  const left = Math.min(startX, endX) + window.scrollX;
  const top = Math.min(startY, endY) + window.scrollY;
  const width = Math.max(Math.abs(endX - startX), 180);
  const height = Math.max(Math.abs(endY - startY), 72);

  return { left, top, width, height };
}

function clampBounds(bounds) {
  return {
    top: Math.max(0, bounds.top),
    left: Math.max(0, bounds.left),
    width: bounds.width,
    height: bounds.height,
  };
}

function isValidSelectionStart(event) {
  if ((!event.shiftKey && !placementMode) || event.button !== 0) {
    return false;
  }

  const path = event.composedPath?.() || [];
  return !path.includes(widgetRoot);
}

function isWidgetDragStart(event) {
  if (!event.shiftKey || event.button !== 0 || !widgetRoot || !widgetBounds) {
    return false;
  }

  const path = event.composedPath?.() || [];
  return path.includes(widgetCard) || path.includes(widgetRoot);
}

function handlePointerDown(event) {
  if (isWidgetDragStart(event)) {
    dragState = {
      offsetX: event.clientX + window.scrollX - widgetBounds.left,
      offsetY: event.clientY + window.scrollY - widgetBounds.top,
    };
    event.preventDefault();
    return;
  }

  if (!isValidSelectionStart(event)) {
    return;
  }

  selectionState = {
    startX: event.clientX,
    startY: event.clientY,
  };

  updateSelectionBox(
    normalizeSelection(
      selectionState.startX,
      selectionState.startY,
      event.clientX,
      event.clientY
    )
  );

  event.preventDefault();
}

function handlePointerMove(event) {
  if (dragState && widgetBounds) {
    widgetBounds = clampBounds({
      ...widgetBounds,
      left: event.clientX + window.scrollX - dragState.offsetX,
      top: event.clientY + window.scrollY - dragState.offsetY,
    });
    renderWidget();
    event.preventDefault();
    return;
  }

  if (!selectionState) {
    return;
  }

  updateSelectionBox(
    normalizeSelection(
      selectionState.startX,
      selectionState.startY,
      event.clientX,
      event.clientY
    )
  );
}

async function handlePointerUp(event) {
  if (dragState && widgetBounds) {
    dragState = null;
    widgetTheme = sampleTheme(widgetBounds);
    await chrome.storage.local.set({
      widgetBounds,
      widgetEnabled: true,
    });
    renderWidget();
    return;
  }

  if (!selectionState) {
    return;
  }

  const nextBounds = normalizeSelection(
    selectionState.startX,
    selectionState.startY,
    event.clientX,
    event.clientY
  );

  selectionState = null;
  clearSelectionBox();

  widgetBounds = nextBounds;
  widgetTheme = sampleTheme(nextBounds);
  widgetEnabled = true;
  placementMode = false;

  await chrome.storage.local.set({
    placementMode: false,
    widgetBounds: nextBounds,
    widgetEnabled: true,
  });

  renderWidget();
}

function handleStorageChange(changes, areaName) {
  if (areaName !== "local") {
    return;
  }

  if (changes.widgetEnabled) {
    widgetEnabled = changes.widgetEnabled.newValue;
  }

  if (changes.placementMode) {
    placementMode = changes.placementMode.newValue;
  }

  if (changes.widgetBounds) {
    widgetBounds = changes.widgetBounds.newValue;
  }

  if (changes.stockData) {
    stockDataCache = changes.stockData.newValue;
  }

  renderWidget();
}

chrome.runtime.onMessage.addListener((request) => {
  if (request.type === "STOCK_DATA_UPDATED") {
    stockDataCache = request.stockData;
    renderWidget();
  }
});

injectStyles();
ensureRoot();
loadState();

document.addEventListener("pointerdown", handlePointerDown, true);
document.addEventListener("pointermove", handlePointerMove, true);
document.addEventListener("pointerup", handlePointerUp, true);
chrome.storage.onChanged.addListener(handleStorageChange);
