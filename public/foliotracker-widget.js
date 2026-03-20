// FolioTracker Scriptable Widget
// Shows live portfolio value + day change on your iOS home screen.
//
// Setup:
//   1. Install Scriptable from the App Store
//   2. Create a new script and paste this code
//   3. Set PORTFOLIO_ID below to your portfolio ID
//   4. If your portfolio is private, set TOKEN to your auth token
//   5. Add a Scriptable widget to your home screen and select this script
//
// Supports: Small (value + change) and Medium (value + top holdings)

// ── Configuration ──────────────────────────────────────────────
const PORTFOLIO_ID = "your-portfolio-id"; // <-- change this
const TOKEN = ""; // leave empty for public portfolios
const BASE_URL = "https://foliotracker.vercel.app";
// ───────────────────────────────────────────────────────────────

const COLORS = {
  bg: new Color("#ffffff"),
  cardBg: new Color("#f1f5f9"),
  text: new Color("#0f172a"),
  textSecondary: new Color("#64748b"),
  positive: new Color("#16a34a"),
  negative: new Color("#dc2626"),
  accent: new Color("#2563eb"),
};

async function fetchPortfolio() {
  const url = `${BASE_URL}/api/portfolio?id=${PORTFOLIO_ID}${TOKEN ? `&token=${TOKEN}` : ""}`;
  const req = new Request(url);
  req.timeoutInterval = 15;
  const data = await req.loadJSON();
  if (data.requiresAuth) throw new Error("Auth required");
  return data;
}

function formatCurrency(value) {
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  }
  return `$${value.toFixed(0)}`;
}

function formatChange(value) {
  const sign = value >= 0 ? "+" : "";
  if (Math.abs(value) >= 1_000_000) {
    return `${sign}$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${sign}$${(value / 1_000).toFixed(1)}k`;
  }
  return `${sign}$${value.toFixed(0)}`;
}

function formatPercent(value) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatTime(isoString) {
  const date = new Date(isoString);
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${minutes} ${ampm}`;
}

function computeRegularMarketTotals(data) {
  let totalValue = 0;
  let previousTotal = 0;
  for (const h of data.holdings || []) {
    if (h.isStatic) {
      totalValue += h.value || 0;
      previousTotal += h.value || 0;
    } else {
      const price = h.regularMarketPrice || h.currentPrice || 0;
      const prev = h.previousClose || price;
      totalValue += price * h.shares;
      previousTotal += prev * h.shares;
    }
  }
  const totalDayChange = totalValue - previousTotal;
  const totalDayChangePercent = previousTotal > 0 ? (totalDayChange / previousTotal) * 100 : 0;
  return { totalValue, totalDayChange, totalDayChangePercent };
}

// ── Small Widget ───────────────────────────────────────────────
function buildSmallWidget(data) {
  const w = new ListWidget();
  w.backgroundColor = COLORS.bg;
  w.setPadding(16, 14, 8, 14);
  w.url = `${BASE_URL}/${PORTFOLIO_ID}`;

  const mkt = computeRegularMarketTotals(data);
  const isPositive = mkt.totalDayChange >= 0;
  const changeColor = isPositive ? COLORS.positive : COLORS.negative;

  // Header row: value left, day change % right
  const headerRow = w.addStack();
  headerRow.layoutHorizontally();
  headerRow.centerAlignContent();

  const value = headerRow.addText(formatCurrency(mkt.totalValue));
  value.font = Font.boldSystemFont(16);
  value.textColor = COLORS.text;
  value.minimumScaleFactor = 0.7;
  value.lineLimit = 1;

  headerRow.addSpacer();

  const change = headerRow.addText(formatPercent(mkt.totalDayChangePercent));
  change.font = Font.mediumSystemFont(14);
  change.textColor = changeColor;
  change.lineLimit = 1;

  w.addSpacer(4);

  // Top holdings sorted by portfolio value
  const topHoldings = (data.holdings || [])
    .filter((h) => !h.isStatic)
    .sort((a, b) => {
      const aVal = (a.regularMarketPrice || a.currentPrice || 0) * a.shares;
      const bVal = (b.regularMarketPrice || b.currentPrice || 0) * b.shares;
      return bVal - aVal;
    })
;

  for (const h of topHoldings) {
    const row = w.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();
    row.spacing = 4;

    const ticker = row.addText(h.ticker);
    ticker.font = Font.regularMonospacedSystemFont(10);
    ticker.textColor = COLORS.text;
    ticker.lineLimit = 1;

    row.addSpacer();

    const price = h.regularMarketPrice || h.currentPrice || 0;
    const priceText = row.addText(`$${price.toFixed(2)}`);
    priceText.font = Font.regularMonospacedSystemFont(10);
    priceText.textColor = COLORS.text;
    priceText.lineLimit = 1;

    row.addSpacer(2);

    const pct = h.previousClose > 0
      ? ((price - h.previousClose) / h.previousClose) * 100
      : (h.dayChangePercent || 0);
    const hColor = pct >= 0 ? COLORS.positive : COLORS.negative;
    const pctText = row.addText(formatPercent(pct));
    pctText.font = Font.regularMonospacedSystemFont(10);
    pctText.textColor = hColor;
    pctText.lineLimit = 1;
  }

  w.addSpacer();

  return w;
}

// ── Medium Widget ──────────────────────────────────────────────
function buildMediumWidget(data) {
  const w = new ListWidget();
  w.backgroundColor = COLORS.bg;
  w.setPadding(12, 16, 12, 16);
  w.url = `${BASE_URL}/${PORTFOLIO_ID}`;

  const mkt = computeRegularMarketTotals(data);
  const isPositive = mkt.totalDayChange >= 0;
  const changeColor = isPositive ? COLORS.positive : COLORS.negative;

  // ── Top row: market status ──
  const topRow = w.addStack();
  topRow.layoutHorizontally();
  topRow.centerAlignContent();

  topRow.addSpacer();

  const status = topRow.addText(data.marketStatus === "open" ? "LIVE" : data.marketStatus?.toUpperCase() || "");
  status.font = Font.boldSystemFont(9);
  status.textColor = data.marketStatus === "open" ? COLORS.positive : COLORS.textSecondary;

  w.addSpacer(4);

  // ── Value row: total left, stacked change right ──
  const valueRow = w.addStack();
  valueRow.layoutHorizontally();
  valueRow.centerAlignContent();

  const value = valueRow.addText(formatCurrency(mkt.totalValue));
  value.font = Font.boldSystemFont(24);
  value.textColor = COLORS.text;
  value.minimumScaleFactor = 0.7;

  valueRow.addSpacer(8);

  const changeStack = valueRow.addStack();
  changeStack.layoutVertically();

  const changeDollar = changeStack.addText(formatChange(mkt.totalDayChange));
  changeDollar.font = Font.mediumSystemFont(12);
  changeDollar.textColor = changeColor;

  const changePct = changeStack.addText(formatPercent(mkt.totalDayChangePercent));
  changePct.font = Font.mediumSystemFont(12);
  changePct.textColor = changeColor;

  valueRow.addSpacer();

  w.addSpacer(8);

  // ── Two-column holdings grid ──
  const holdings = (data.holdings || [])
    .filter((h) => !h.isStatic)
    .sort((a, b) => {
      const aVal = (a.regularMarketPrice || a.currentPrice || 0) * a.shares;
      const bVal = (b.regularMarketPrice || b.currentPrice || 0) * b.shares;
      return bVal - aVal;
    });

  for (let i = 0; i < holdings.length; i += 2) {
    const row = w.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();

    for (let col = 0; col < 2; col++) {
      const h = holdings[i + col];
      const cell = row.addStack();
      cell.layoutHorizontally();
      cell.centerAlignContent();
      cell.size = new Size(148, 0);

      if (h) {
        const ticker = cell.addText(h.ticker);
        ticker.font = Font.regularMonospacedSystemFont(11);
        ticker.textColor = COLORS.text;
        ticker.lineLimit = 1;

        cell.addSpacer(4);

        const pct = h.previousClose > 0
          ? ((h.regularMarketPrice - h.previousClose) / h.previousClose) * 100
          : (h.dayChangePercent || 0);
        const hChangeColor = pct >= 0 ? COLORS.positive : COLORS.negative;
        const pctText = cell.addText(formatPercent(pct));
        pctText.font = Font.regularMonospacedSystemFont(11);
        pctText.textColor = hChangeColor;
        pctText.lineLimit = 1;
      }

      if (col === 0) row.addSpacer();
    }

    w.addSpacer(2);
  }

  w.addSpacer();

  return w;
}

// ── Error Widget ───────────────────────────────────────────────
function buildErrorWidget(message) {
  const w = new ListWidget();
  w.backgroundColor = COLORS.bg;
  w.setPadding(16, 16, 16, 16);
  w.url = `${BASE_URL}/${PORTFOLIO_ID}`;

  const title = w.addText("FolioTracker");
  title.font = Font.semiboldSystemFont(12);
  title.textColor = COLORS.accent;

  w.addSpacer(8);

  const err = w.addText(message);
  err.font = Font.regularSystemFont(12);
  err.textColor = COLORS.negative;

  return w;
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  let widget;

  try {
    if (PORTFOLIO_ID === "your-portfolio-id") {
      widget = buildErrorWidget("Set your portfolio ID in the script configuration.");
    } else {
      const data = await fetchPortfolio();
      const family = config.widgetFamily || "small";
      widget = family === "medium" ? buildMediumWidget(data) : buildSmallWidget(data);
    }
  } catch (e) {
    widget = buildErrorWidget(e.message || "Failed to load portfolio");
  }

  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    // Preview when running in-app
    widget.presentMedium();
  }

  Script.complete();
}

await main();
