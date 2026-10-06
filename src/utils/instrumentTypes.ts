// Map instrument types from API to display categories (also used by the
// Portfolio History allocation chart, so a category keeps its color app-wide)
export const TYPE_CATEGORY_MAP: Record<string, { name: string; color: string }> = {
  'Common Stock': { name: 'Stocks', color: '#8b5cf6' }, // purple
  'American Depositary Receipt': { name: 'Stocks', color: '#8b5cf6' }, // ADRs like TSM
  'ETF': { name: 'Funds', color: '#3b82f6' }, // blue
  'Mutual Fund': { name: 'Funds', color: '#3b82f6' }, // blue
  'Bond ETF': { name: 'Funds', color: '#3b82f6' }, // blue (backwards compat)
  'Bond Mutual Fund': { name: 'Funds', color: '#3b82f6' }, // blue (backwards compat)
  'Money Market': { name: 'Cash / Money Market', color: '#22c55e' }, // green
  'Cash': { name: 'Cash / Money Market', color: '#22c55e' }, // green
  'Real Estate': { name: 'Real Estate', color: '#f59e0b' }, // amber
  'Crypto': { name: 'Crypto', color: '#f97316' }, // orange
  'Bonds': { name: 'Bonds', color: '#06b6d4' }, // cyan (static bonds)
  'Liabilities': { name: 'Liabilities', color: '#ef4444' },
  'Other': { name: 'Other', color: '#6b7280' }, // gray
};
