export interface Headline {
  text: string;
  url: string;
  sortKey?: number;
}

const BULLET_PREFIX_RE = /^\s*-\s+(?:\*\*([A-Za-z]{3})\s+(\d{1,2})\*\*\s*:\s*)?/;
const MD_LINK_RE = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
const TRAILING_PUNCT_RE = /[\s.;,]+$/;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const FUTURE_SLOP_MS = 2 * 24 * 60 * 60 * 1000;

function parseSortKey(monAbbr: string | undefined, dayStr: string | undefined): number | undefined {
  if (!monAbbr || !dayStr) return undefined;
  const month = MONTHS[monAbbr.toLowerCase()];
  if (month === undefined) return undefined;
  const day = Number.parseInt(dayStr, 10);
  if (!Number.isFinite(day)) return undefined;
  const now = new Date();
  let year = now.getFullYear();
  let ts = new Date(year, month, day).getTime();
  if (ts - now.getTime() > FUTURE_SLOP_MS) {
    ts = new Date(year - 1, month, day).getTime();
  }
  return ts;
}

export function extractHeadlines(summaryMarkdown: string): Headline[] {
  const lines = summaryMarkdown.split('\n');
  const headlines: Headline[] = [];

  for (const line of lines) {
    if (!/^\s*-\s+/.test(line)) continue;

    const prefixMatch = line.match(BULLET_PREFIX_RE);
    const sortKey = prefixMatch ? parseSortKey(prefixMatch[1], prefixMatch[2]) : undefined;
    const withoutPrefix = line.replace(BULLET_PREFIX_RE, '');

    const firstLink = MD_LINK_RE.exec(withoutPrefix);
    MD_LINK_RE.lastIndex = 0;
    if (!firstLink) continue;
    const url = firstLink[2];

    let text = withoutPrefix.replace(MD_LINK_RE, '').replace(/\s+/g, ' ').trim();
    text = text.replace(TRAILING_PUNCT_RE, '');
    if (text.length === 0) continue;

    headlines.push({ text, url, sortKey });
  }

  return headlines;
}
