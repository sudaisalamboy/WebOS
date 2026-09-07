import { test, expect } from '@playwright/test';

test.describe('Camera', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/');
    await page.fill('input[type="password"]', 'test1234');
    await page.click('button:has-text("Login")');
    await expect(page.locator('.desktop')).toBeVisible();
  });

  test('should open camera app', async ({ page }) => {
    await page.click('text=Camera');
    
    await expect(page.locator('text=Camera')).toBeVisible();
  });

  test('should request camera permissions', async ({ page }) => {
    await page.click('text=Camera');
    
    // Grant camera permission
    await page.context().grantPermissions(['camera']);
    
    await expect(page.locator('video')).toBeVisible();
  });

  test('should capture photo', async ({ page }) => {
    await page.click('text=Camera');
    await page.context().grantPermissions(['camera']);
    
    await page.click('button:has-text("Capture")');
    
    await expect(page.locator('img')).toBeVisible();
  });

  test('should switch between front and back camera', async ({ page }) => {
    await page.click('text=Camera');
    await page.context().grantPermissions(['camera']);
    
    await page.click('button:has-text("Switch Camera")');
    
    await expect(page.locator('video')).toBeVisible();
  });
});
