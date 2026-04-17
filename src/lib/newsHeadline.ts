export interface Headline {
  text: string;
  url: string;
}

const BULLET_PREFIX_RE = /^\s*-\s+(?:\*\*[A-Za-z]{3}\s+\d{1,2}\*\*\s*:\s*)?/;
const MD_LINK_RE = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
const TRAILING_PUNCT_RE = /[\s.;,]+$/;
const MAX_LEN = 100;
const TRUNC_TARGET = 97;

export function extractHeadlines(summaryMarkdown: string): Headline[] {
  const lines = summaryMarkdown.split('\n');
  const headlines: Headline[] = [];

  for (const line of lines) {
    if (!/^\s*-\s+/.test(line)) continue;

    const withoutPrefix = line.replace(BULLET_PREFIX_RE, '');

    const firstLink = MD_LINK_RE.exec(withoutPrefix);
    MD_LINK_RE.lastIndex = 0;
    if (!firstLink) continue;
    const url = firstLink[2];

    let text = withoutPrefix.replace(MD_LINK_RE, '').replace(/\s+/g, ' ').trim();
    text = text.replace(TRAILING_PUNCT_RE, '');
    if (text.length === 0) continue;

    if (text.length > MAX_LEN) {
      const cutoff = text.lastIndexOf(' ', TRUNC_TARGET);
      const sliceEnd = cutoff > 40 ? cutoff : TRUNC_TARGET;
      text = text.slice(0, sliceEnd).replace(TRAILING_PUNCT_RE, '') + '…';
    }

    headlines.push({ text, url });
  }

  return headlines;
}
