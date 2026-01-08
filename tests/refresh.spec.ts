import { test, expect } from '@playwright/test';

test.describe('Portfolio Page', () => {
  test('should load portfolio and make API requests', async ({ page }) => {
    const portfolioRequests: string[] = [];

    // Intercept network requests to track API calls
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/portfolio')) {
        portfolioRequests.push(url);
        console.log(`[${new Date().toLocaleTimeString()}] Portfolio API request: ${url}`);
      }
    });

    // Navigate to a portfolio page
    await page.goto('/av');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Should see portfolio content
    await expect(page.getByText('Total Portfolio Value')).toBeVisible({ timeout: 20000 });

    // Initial request should have been made
    expect(portfolioRequests.length).toBeGreaterThanOrEqual(1);
    console.log(`Page loaded successfully. API requests made: ${portfolioRequests.length}`);

    // Verify the request includes the portfolio ID
    expect(portfolioRequests[0]).toContain('id=av');
  });

  test('should load landing page with portfolio list', async ({ page }) => {
    const portfoliosRequests: string[] = [];

    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/portfolios')) {
        portfoliosRequests.push(url);
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Should see portfolios heading
    await expect(page.getByText('Portfolios')).toBeVisible({ timeout: 15000 });

    // API request should have been made
    expect(portfoliosRequests.length).toBeGreaterThanOrEqual(1);
  });
});
