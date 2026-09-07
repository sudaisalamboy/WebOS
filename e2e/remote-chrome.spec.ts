import { test, expect } from '@playwright/test';

test.describe('Remote Chrome', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/');
    await page.fill('input[type="password"]', 'test1234');
    await page.click('button:has-text("Login")');
    await expect(page.locator('.desktop')).toBeVisible();
  });

  test('should open remote chrome app', async ({ page }) => {
    await page.click('text=Remote Chrome');
    
    await expect(page.locator('text=Remote Chrome')).toBeVisible();
  });

  test('should navigate to a URL', async ({ page }) => {
    await page.click('text=Remote Chrome');
    
    await page.fill('input[placeholder*="URL"]', 'https://example.com');
    await page.click('button:has-text("Go")');
    
    await expect(page.locator('iframe')).toBeVisible();
  });

  test('should handle browser controls', async ({ page }) => {
    await page.click('text=Remote Chrome');
    
    await page.fill('input[placeholder*="URL"]', 'https://example.com');
    await page.click('button:has-text("Go")');
    
    // Test back button
    await page.click('[aria-label="Back"]');
    
    // Test refresh button
    await page.click('[aria-label="Refresh"]');
  });
});
