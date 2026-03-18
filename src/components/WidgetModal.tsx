import { useState } from 'react';
import { X, Copy, Check } from 'lucide-react';

interface WidgetModalProps {
  onClose: () => void;
  portfolioId: string;
  token?: string | null;
}

function getWidgetScript(portfolioId: string, token: string) {
  return `// FolioTracker Scriptable Widget
// Shows live portfolio value + day change on your iOS home screen.

// ── Configuration ──────────────────────────────────────────────
const PORTFOLIO_ID = ${JSON.stringify(portfolioId)};
const TOKEN = ${JSON.stringify(token)};
const BASE_URL = "https://foliotracker.vercel.app";
// ───────────────────────────────────────────────────────────────

const COLORS = {
  bg: new Color("#0f172a"),
  cardBg: new Color("#1e293b"),
  text: new Color("#f8fafc"),
  textSecondary: new Color("#94a3b8"),
  positive: new Color("#22c55e"),
  negative: new Color("#ef4444"),
  accent: new Color("#3b82f6"),
};

async function fetchPortfolio() {
  const url = \`\${BASE_URL}/api/portfolio?id=\${PORTFOLIO_ID}\${TOKEN ? \`&token=\${TOKEN}\` : ""}\`;
  const req = new Request(url);
  req.timeoutInterval = 15;
  const data = await req.loadJSON();
  if (data.requiresAuth) throw new Error("Auth required");
  return data;
}

function formatCurrency(value) {
  if (Math.abs(value) >= 1_000_000) {
    return \`$\${(value / 1_000_000).toFixed(2)}M\`;
  }
  if (Math.abs(value) >= 1_000) {
    return \`$\${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k\`;
  }
  return \`$\${value.toFixed(0)}\`;
}

function formatChange(value) {
  const sign = value >= 0 ? "+" : "";
  if (Math.abs(value) >= 1_000_000) {
    return \`\${sign}$\${(value / 1_000_000).toFixed(2)}M\`;
  }
  if (Math.abs(value) >= 1_000) {
    return \`\${sign}$\${(value / 1_000).toFixed(1)}k\`;
  }
  return \`\${sign}$\${value.toFixed(0)}\`;
}

function formatPercent(value) {
  const sign = value >= 0 ? "+" : "";
  return \`\${sign}\${value.toFixed(2)}%\`;
}

function formatTime(isoString) {
  const date = new Date(isoString);
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  return \`\${hours % 12 || 12}:\${minutes} \${ampm}\`;
}

// ── Small Widget ───────────────────────────────────────────────
function buildSmallWidget(data) {
  const w = new ListWidget();
  w.backgroundColor = COLORS.bg;
  w.setPadding(12, 14, 12, 14);
  w.url = \`\${BASE_URL}/\${PORTFOLIO_ID}\`;

  const isPositive = data.totalDayChange >= 0;
  const changeColor = isPositive ? COLORS.positive : COLORS.negative;

  const name = w.addText(data.displayName || PORTFOLIO_ID.toUpperCase());
  name.font = Font.semiboldSystemFont(11);
  name.textColor = COLORS.textSecondary;

  w.addSpacer(6);

  const value = w.addText(formatCurrency(data.totalValue));
  value.font = Font.boldSystemFont(22);
  value.textColor = COLORS.text;
  value.minimumScaleFactor = 0.7;

  w.addSpacer(4);

  const changeLine = \`\${formatChange(data.totalDayChange)}  \${formatPercent(data.totalDayChangePercent)}\`;
  const change = w.addText(changeLine);
  change.font = Font.mediumSystemFont(13);
  change.textColor = changeColor;

  w.addSpacer();

  const updated = w.addText(formatTime(data.lastUpdated));
  updated.font = Font.regularSystemFont(9);
  updated.textColor = COLORS.textSecondary;
  updated.textOpacity = 0.6;

  return w;
}

// ── Medium Widget ──────────────────────────────────────────────
function buildMediumWidget(data) {
  const w = new ListWidget();
  w.backgroundColor = COLORS.bg;
  w.setPadding(12, 16, 12, 16);
  w.url = \`\${BASE_URL}/\${PORTFOLIO_ID}\`;

  const isPositive = data.totalDayChange >= 0;
  const changeColor = isPositive ? COLORS.positive : COLORS.negative;

  const topRow = w.addStack();
  topRow.layoutHorizontally();
  topRow.centerAlignContent();

  const name = topRow.addText(data.displayName || PORTFOLIO_ID.toUpperCase());
  name.font = Font.semiboldSystemFont(12);
  name.textColor = COLORS.textSecondary;

  topRow.addSpacer();

  const status = topRow.addText(data.marketStatus === "open" ? "LIVE" : data.marketStatus?.toUpperCase() || "");
  status.font = Font.boldSystemFont(9);
  status.textColor = data.marketStatus === "open" ? COLORS.positive : COLORS.textSecondary;

  w.addSpacer(4);

  const valueRow = w.addStack();
  valueRow.layoutHorizontally();
  valueRow.bottomAlignContent();

  const value = valueRow.addText(formatCurrency(data.totalValue));
  value.font = Font.boldSystemFont(24);
  value.textColor = COLORS.text;
  value.minimumScaleFactor = 0.7;

  valueRow.addSpacer(8);

  const changeLine = \`\${formatChange(data.totalDayChange)}  (\${formatPercent(data.totalDayChangePercent)})\`;
  const change = valueRow.addText(changeLine);
  change.font = Font.mediumSystemFont(12);
  change.textColor = changeColor;
  change.minimumScaleFactor = 0.7;

  valueRow.addSpacer();

  w.addSpacer(8);

  const holdings = (data.holdings || [])
    .filter((h) => !h.isStatic)
    .sort((a, b) => b.value - a.value)
    .slice(0, 4);

  for (const h of holdings) {
    const row = w.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();
    row.spacing = 4;

    const ticker = row.addText(h.ticker);
    ticker.font = Font.monospacedSystemFont(11, 0.3);
    ticker.textColor = COLORS.text;
    ticker.lineLimit = 1;

    row.addSpacer();

    const hChangeColor = h.dayChangePercent >= 0 ? COLORS.positive : COLORS.negative;
    const pctText = row.addText(formatPercent(h.dayChangePercent));
    pctText.font = Font.monospacedSystemFont(11, 0.3);
    pctText.textColor = hChangeColor;
    pctText.lineLimit = 1;

    w.addSpacer(2);
  }

  w.addSpacer();

  const updated = w.addText(\`Updated \${formatTime(data.lastUpdated)}\`);
  updated.font = Font.regularSystemFont(9);
  updated.textColor = COLORS.textSecondary;
  updated.textOpacity = 0.6;

  return w;
}

// ── Error Widget ───────────────────────────────────────────────
function buildErrorWidget(message) {
  const w = new ListWidget();
  w.backgroundColor = COLORS.bg;
  w.setPadding(16, 16, 16, 16);
  w.url = \`\${BASE_URL}/\${PORTFOLIO_ID}\`;

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
    widget.presentMedium();
  }

  Script.complete();
}

await main();`;
}

export function WidgetModal({ onClose, portfolioId, token }: WidgetModalProps) {
  const [copied, setCopied] = useState(false);

  const script = getWidgetScript(portfolioId, token || '');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-card border border-border rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 hover:bg-background rounded-lg transition-colors"
        >
          <X className="w-5 h-5 text-text-secondary" />
        </button>

        <h2 className="text-xl font-semibold text-text-primary mb-2">
          Home Screen Widget
        </h2>
        <p className="text-text-secondary text-sm mb-6">
          Display your portfolio value on your iOS home screen using Scriptable.
        </p>

        <ol className="text-sm text-text-secondary space-y-3 mb-6">
          <li className="flex items-start gap-2">
            <span className="font-medium text-text-primary">1.</span>
            <span>
              Install <a href="https://apps.apple.com/app/scriptable/id1405459188" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Scriptable</a> from the App Store
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="font-medium text-text-primary">2.</span>
            <span>Open Scriptable and tap <strong className="text-text-primary">+</strong> to create a new script</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="font-medium text-text-primary">3.</span>
            <span>Copy the script below and paste it in</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="font-medium text-text-primary">4.</span>
            <span>Add a <strong className="text-text-primary">Scriptable</strong> widget to your home screen and select this script</span>
          </li>
        </ol>

        {/* Script code block */}
        <div className="relative mb-4">
          <div className="bg-background border border-border rounded-xl p-4 max-h-48 overflow-y-auto">
            <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap break-all">
              {script}
            </pre>
          </div>
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 flex items-center gap-1.5 bg-card hover:bg-card/80 border border-border text-text-secondary hover:text-text-primary text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-green-500" />
                <span className="text-green-500">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copy Script
              </>
            )}
          </button>
        </div>

        {token && (
          <p className="text-xs text-text-secondary/70 mb-4">
            Your token expires in ~30 days. After that, log in again and re-copy the script.
          </p>
        )}

        <button
          onClick={onClose}
          className="w-full bg-accent hover:bg-accent/90 text-white font-medium py-2 px-4 rounded-xl transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
