const ROOT_ID = "stock-widget-root";
const STYLE_ID = "stock-widget-style";

let root = null;
let selectionBox = null;
let selectionState = null;
let dragState = null;
let resizeState = null;
let widgets = [];
let pendingWidgetDraft = null;
let quotesBySymbol = {};
let shiftPressed = false;

function injectStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${ROOT_ID} {
      position: absolute;
      inset: 0;
      z-index: 2147483646;
      pointer-events: none;
    }

    #${ROOT_ID}[data-hidden="true"] {
      display: none;
    }

    #${ROOT_ID} .stock-widget {
      position: absolute;
      pointer-events: auto;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: center;
      padding: 8px 10px;
      background: transparent;
      border: none;
      box-shadow: none;
      color: var(--stock-color, rgb(15, 23, 42));
      font-family: var(--stock-font-family, inherit);
      border-radius: var(--stock-radius, 0px);
      user-select: none;
      cursor: default;
    }

    #${ROOT_ID}[data-edit-mode="true"] .stock-widget {
      cursor: grab;
    }

    #${ROOT_ID} .stock-widget-resize {
      position: absolute;
      right: 2px;
      bottom: 2px;
      width: 14px;
      height: 14px;
      pointer-events: none;
      cursor: default;
      opacity: 0;
      transition: opacity 120ms ease;
    }

    #${ROOT_ID}[data-edit-mode="true"] .stock-widget-resize {
      opacity: 0.5;
      pointer-events: auto;
      cursor: nwse-resize;
    }

    #${ROOT_ID} .stock-widget-resize::before {
      content: "";
      position: absolute;
      right: 0;
      bottom: 0;
      width: 10px;
      height: 10px;
      border-right: 1px solid var(--stock-muted, rgba(15, 23, 42, 0.7));
      border-bottom: 1px solid var(--stock-muted, rgba(15, 23, 42, 0.7));
    }

    #${ROOT_ID} .stock-main,
    #${ROOT_ID} .stock-side {
      min-width: 0;
    }

    #${ROOT_ID} .stock-label,
    #${ROOT_ID} .stock-name,
    #${ROOT_ID} .stock-meta {
      color: var(--stock-muted, rgba(15, 23, 42, 0.7));
    }

    #${ROOT_ID} .stock-label {
      font-size: 11px;
      text-transform: uppercase;
      margin-bottom: 2px;
    }

    #${ROOT_ID} .stock-price {
      font-size: 22px;
      line-height: 1;
      font-weight: 700;
      color: var(--stock-strong, var(--stock-color, rgb(15, 23, 42)));
    }

    #${ROOT_ID} .stock-name {
      margin-top: 4px;
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    #${ROOT_ID} .stock-change {
      font-size: 12px;
      font-weight: 700;
      text-align: right;
      white-space: nowrap;
      color: var(--stock-strong, var(--stock-color, rgb(15, 23, 42)));
    }

    #${ROOT_ID} .stock-meta {
      margin-top: 4px;
      font-size: 11px;
      text-align: right;
    }

    .stock-widget-selection {
      position: absolute;
      z-index: 2147483647;
      pointer-events: none;
      background: rgba(148, 163, 184, 0.12);
      box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.14);
    }
  `;

  document.documentElement.appendChild(style);
}

function ensureRoot() {
  if (root?.isConnected) {
    return root;
  }

  root = document.createElement("div");
  root.id = ROOT_ID;
  root.dataset.hidden = "true";
  root.dataset.editMode = "false";
  document.documentElement.appendChild(root);
  return root;
}

function parseColor(color) {
  const match = color?.match(/\d+(\.\d+)?/g);
  if (!match || match.length < 3) {
    return null;
  }

  return {
    r: Number(match[0]),
    g: Number(match[1]),
    b: Number(match[2]),
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
  const fg = getRelativeLuminance(foreground);
  const bg = getRelativeLuminance(background);
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

function withAlpha(color, alpha) {
  const parsed = parseColor(color);
  if (!parsed) {
    return color;
  }

  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${alpha})`;
}

function pickReadableTextColor(preferredColor, backgroundColor) {
  const light = "rgb(248, 250, 252)";
  const dark = "rgb(15, 23, 42)";

  if (getContrastRatio(preferredColor, backgroundColor) >= 4.5) {
    return preferredColor;
  }

  return getContrastRatio(light, backgroundColor) > getContrastRatio(dark, backgroundColor)
    ? light
    : dark;
}

function sampleTheme(bounds) {
  const x = Math.max(
    0,
    Math.min(window.innerWidth - 1, bounds.left - window.scrollX + bounds.width / 2)
  );
  const y = Math.max(
    0,
    Math.min(window.innerHeight - 1, bounds.top - window.scrollY + bounds.height / 2)
  );

  const previousPointerEvents = root?.style.pointerEvents || "";
  if (root) {
    root.style.pointerEvents = "none";
  }

  const sampleElement = document.elementFromPoint(x, y);

  if (root) {
    root.style.pointerEvents = previousPointerEvents;
  }

  const baseElement =
    sampleElement?.closest("button, a, section, article, aside, nav, div, li, p, span") ||
    sampleElement ||
    document.body;
  const computed = window.getComputedStyle(baseElement);
  const bodyStyle = window.getComputedStyle(document.body);
  const htmlStyle = window.getComputedStyle(document.documentElement);

  const backgroundColor =
    computed.backgroundColor && computed.backgroundColor !== "rgba(0, 0, 0, 0)"
      ? computed.backgroundColor
      : bodyStyle.backgroundColor && bodyStyle.backgroundColor !== "rgba(0, 0, 0, 0)"
        ? bodyStyle.backgroundColor
        : htmlStyle.backgroundColor;

  const textColor = pickReadableTextColor(computed.color || bodyStyle.color, backgroundColor);

  return {
    textColor,
    strongColor: withAlpha(textColor, 0.94),
    mutedColor: withAlpha(textColor, 0.72),
    fontFamily: computed.fontFamily || bodyStyle.fontFamily,
    radius:
      computed.borderRadius && computed.borderRadius !== "0px"
        ? computed.borderRadius
        : "0px",
  };
}

function formatPrice(quote) {
  if (typeof quote?.price !== "number") {
    return "--";
  }

  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: quote.currency || "USD",
    maximumFractionDigits: quote.currency === "KRW" ? 0 : 2,
  }).format(quote.price);
}

function formatChange(quote) {
  if (typeof quote?.change !== "number" || typeof quote?.changePercent !== "number") {
    return "대기 중";
  }

  const direction = quote.change > 0 ? "▲" : quote.change < 0 ? "▼" : "•";
  const absoluteChange = Math.abs(quote.change);
  const absolutePercent = Math.abs(quote.changePercent);
  return `${direction} ${absoluteChange.toLocaleString("ko-KR")} (${absolutePercent.toFixed(
    2
  )}%)`;
}

function formatUpdatedAt(quote) {
  if (!quote?.updatedAt) {
    return "";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(quote.updatedAt);
}

function renderWidgets() {
  ensureRoot();
  root.innerHTML = "";
  root.dataset.hidden = widgets.length === 0 ? "true" : "false";
  root.dataset.editMode =
    shiftPressed || Boolean(selectionState) || Boolean(dragState) || Boolean(resizeState)
      ? "true"
      : "false";

  for (const widget of widgets) {
    const quote = quotesBySymbol[widget.symbol] || null;
    const theme = sampleTheme(widget);

    const element = document.createElement("div");
    element.className = "stock-widget";
    element.dataset.widgetId = widget.id;
    element.style.left = `${widget.left}px`;
    element.style.top = `${widget.top}px`;
    element.style.width = `${widget.width}px`;
    element.style.height = `${widget.height}px`;
    element.style.setProperty("--stock-color", theme.textColor);
    element.style.setProperty("--stock-strong", theme.strongColor);
    element.style.setProperty("--stock-muted", theme.mutedColor);
    element.style.setProperty("--stock-font-family", theme.fontFamily);
    element.style.setProperty("--stock-radius", theme.radius);

    element.innerHTML = `
      <div class="stock-main">
        <div class="stock-label">${widget.symbol}</div>
        <div class="stock-price">${formatPrice(quote)}</div>
        <div class="stock-name">${widget.shortName}</div>
      </div>
      <div class="stock-side">
        <div class="stock-change">${formatChange(quote)}</div>
        <div class="stock-meta">${formatUpdatedAt(quote)}</div>
      </div>
      <div class="stock-widget-resize" data-resize-id="${widget.id}"></div>
    `;

    root.appendChild(element);
  }
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

function clearSelectionBox() {
  if (selectionBox?.isConnected) {
    selectionBox.remove();
  }
  selectionBox = null;
}

function normalizeBounds(startX, startY, endX, endY) {
  return {
    left: Math.min(startX, endX) + window.scrollX,
    top: Math.min(startY, endY) + window.scrollY,
    width: Math.max(Math.abs(endX - startX), 180),
    height: Math.max(Math.abs(endY - startY), 72),
  };
}

function clampBounds(bounds) {
  return {
    ...bounds,
    left: Math.max(0, bounds.left),
    top: Math.max(0, bounds.top),
    width: Math.max(180, bounds.width),
    height: Math.max(72, bounds.height),
  };
}

function findWidgetFromEvent(event) {
  const target = event.target?.closest?.(".stock-widget");
  if (!target) {
    return null;
  }

  return widgets.find((widget) => widget.id === target.dataset.widgetId) || null;
}

function findResizeHandleFromEvent(event) {
  const target = event.target?.closest?.("[data-resize-id]");
  if (!target) {
    return null;
  }

  return widgets.find((widget) => widget.id === target.dataset.resizeId) || null;
}

function canStartSelection(event) {
  return Boolean(event.shiftKey && event.button === 0 && pendingWidgetDraft);
}

async function loadState() {
  const stored = await chrome.storage.local.get([
    "widgets",
    "pendingWidgetDraft",
    "quotesBySymbol",
  ]);

  widgets = Array.isArray(stored.widgets) ? stored.widgets : [];
  pendingWidgetDraft = stored.pendingWidgetDraft || null;
  quotesBySymbol = stored.quotesBySymbol || {};
  renderWidgets();
}

function handlePointerDown(event) {
  const resizeWidget = findResizeHandleFromEvent(event);
  if (event.shiftKey && event.button === 0 && resizeWidget) {
    resizeState = {
      widgetId: resizeWidget.id,
      startX: event.clientX + window.scrollX,
      startY: event.clientY + window.scrollY,
      startWidth: resizeWidget.width,
      startHeight: resizeWidget.height,
    };
    event.preventDefault();
    return;
  }

  const widget = findWidgetFromEvent(event);

  if (event.shiftKey && event.button === 0 && widget) {
    dragState = {
      widgetId: widget.id,
      offsetX: event.clientX + window.scrollX - widget.left,
      offsetY: event.clientY + window.scrollY - widget.top,
    };
    event.preventDefault();
    return;
  }

  if (!canStartSelection(event) || widget) {
    return;
  }

  selectionState = {
    startX: event.clientX,
    startY: event.clientY,
  };

  updateSelectionBox(
    normalizeBounds(selectionState.startX, selectionState.startY, event.clientX, event.clientY)
  );
  event.preventDefault();
}

function handlePointerMove(event) {
  if (resizeState) {
    const currentX = event.clientX + window.scrollX;
    const currentY = event.clientY + window.scrollY;
    const deltaX = currentX - resizeState.startX;
    const deltaY = currentY - resizeState.startY;

    widgets = widgets.map((widget) =>
      widget.id === resizeState.widgetId
        ? clampBounds({
            ...widget,
            width: resizeState.startWidth + deltaX,
            height: resizeState.startHeight + deltaY,
          })
        : widget
    );
    renderWidgets();
    event.preventDefault();
    return;
  }

  if (dragState) {
    widgets = widgets.map((widget) =>
      widget.id === dragState.widgetId
        ? clampBounds({
            ...widget,
            left: event.clientX + window.scrollX - dragState.offsetX,
            top: event.clientY + window.scrollY - dragState.offsetY,
          })
        : widget
    );
    renderWidgets();
    event.preventDefault();
    return;
  }

  if (!selectionState) {
    return;
  }

  updateSelectionBox(
    normalizeBounds(selectionState.startX, selectionState.startY, event.clientX, event.clientY)
  );
}

async function handlePointerUp(event) {
  if (resizeState) {
    resizeState = null;
    await chrome.storage.local.set({ widgets });
    renderWidgets();
    return;
  }

  if (dragState) {
    const movedWidget = widgets.find((widget) => widget.id === dragState.widgetId);
    dragState = null;
    await chrome.storage.local.set({ widgets });
    if (movedWidget) {
      renderWidgets();
    }
    return;
  }

  if (!selectionState) {
    return;
  }

  const nextBounds = normalizeBounds(
    selectionState.startX,
    selectionState.startY,
    event.clientX,
    event.clientY
  );
  selectionState = null;
  clearSelectionBox();

  if (!pendingWidgetDraft) {
    return;
  }

  const nextWidget = {
    id: crypto.randomUUID(),
    symbol: pendingWidgetDraft.symbol,
    shortName: pendingWidgetDraft.shortName,
    ...clampBounds(nextBounds),
  };

  const nextWidgets = [...widgets, nextWidget];
  widgets = nextWidgets;
  pendingWidgetDraft = null;

  await chrome.storage.local.set({
    widgets: nextWidgets,
    pendingWidgetDraft: null,
  });

  renderWidgets();
}

function handleStorageChange(changes, areaName) {
  if (areaName !== "local") {
    return;
  }

  if (changes.widgets) {
    widgets = changes.widgets.newValue || [];
  }

  if (changes.pendingWidgetDraft) {
    pendingWidgetDraft = changes.pendingWidgetDraft.newValue || null;
  }

  if (changes.quotesBySymbol) {
    quotesBySymbol = changes.quotesBySymbol.newValue || {};
  }

  renderWidgets();
}

function handleKeyState(event) {
  const nextShiftPressed = event.shiftKey;
  if (shiftPressed === nextShiftPressed) {
    return;
  }

  shiftPressed = nextShiftPressed;
  renderWidgets();
}

chrome.runtime.onMessage.addListener((request) => {
  if (request.type === "QUOTES_UPDATED") {
    quotesBySymbol = request.quotesBySymbol || {};
    renderWidgets();
  }
});

injectStyles();
ensureRoot();
loadState();

document.addEventListener("pointerdown", handlePointerDown, true);
document.addEventListener("pointermove", handlePointerMove, true);
document.addEventListener("pointerup", handlePointerUp, true);
document.addEventListener("keydown", handleKeyState, true);
document.addEventListener("keyup", handleKeyState, true);
chrome.storage.onChanged.addListener(handleStorageChange);
