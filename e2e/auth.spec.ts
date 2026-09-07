import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('should show setup screen when no password is set', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Set up your password')).toBeVisible();
  });

  test('should set up password successfully', async ({ page }) => {
    await page.goto('/');
    
    await page.fill('input[type="password"]', 'test1234');
    await page.click('button:has-text("Set Password")');
    
    await expect(page.locator('text=Password set successfully')).toBeVisible();
  });

  test('should login with correct password', async ({ page }) => {
    await page.goto('/');
    
    await page.fill('input[type="password"]', 'test1234');
    await page.click('button:has-text("Login")');
    
    await expect(page).toHaveURL('/');
    await expect(page.locator('.desktop')).toBeVisible();
  });

  test('should fail login with incorrect password', async ({ page }) => {
    await page.goto('/');
    
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button:has-text("Login")');
    
    await expect(page.locator('text=Incorrect password')).toBeVisible();
  });

  test('should logout successfully', async ({ page }) => {
    await page.goto('/');
    
    await page.fill('input[type="password"]', 'test1234');
    await page.click('button:has-text("Login")');
    
    await page.click('[aria-label="Logout"]');
    
    await expect(page.locator('text=Login')).toBeVisible();
  });
});
