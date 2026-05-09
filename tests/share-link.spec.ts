import { test, expect, request } from '@playwright/test';

const PORTFOLIO_ID = process.env.SHARE_TEST_PORTFOLIO_ID || 'av';
const PORTFOLIO_PASSWORD = process.env.SHARE_TEST_PASSWORD;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'https://foliotracker.vercel.app';

test.describe('Share via URL', () => {
  test.skip(
    !PORTFOLIO_PASSWORD,
    'Set SHARE_TEST_PASSWORD (and optionally SHARE_TEST_PORTFOLIO_ID, PLAYWRIGHT_BASE_URL) to run.'
  );

  test('mint, view via URL, revoke', async ({ page }) => {
    const api = await request.newContext({ baseURL: BASE_URL });

    // Mint a share link via the API
    const mintRes = await api.post('/api/share-links', {
      data: {
        portfolioId: PORTFOLIO_ID,
        durationDays: 1,
        label: 'playwright e2e',
        password: PORTFOLIO_PASSWORD,
      },
    });
    expect(mintRes.status()).toBe(201);
    const { id, token } = await mintRes.json();
    expect(typeof id).toBe('string');
    expect(typeof token).toBe('string');
    expect(token).toHaveLength(64);

    // Load the share URL in a fresh browser context — no localStorage from the owner session
    await page.goto(`/${PORTFOLIO_ID}?share=${token}`);
    await expect(page.getByText('Total Portfolio Value')).toBeVisible({ timeout: 20000 });

    // Revoke the share link
    const revokeRes = await api.delete(
      `/api/share-links?id=${id}&portfolioId=${PORTFOLIO_ID}&password=${encodeURIComponent(PORTFOLIO_PASSWORD!)}`
    );
    expect(revokeRes.status()).toBe(200);

    // Hitting the same URL via the API now returns 401
    const portfolioRes = await api.get(`/api/portfolio?id=${PORTFOLIO_ID}&share_token=${token}`);
    expect(portfolioRes.status()).toBe(401);
  });
});
