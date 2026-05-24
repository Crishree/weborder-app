import { expect, test } from '@playwright/test';

test('customer can add items, edit the cart, and complete checkout', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Rajma Bowl' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tossed Chilli Corn' })).toBeVisible();

  await page.getByRole('button', { name: 'Add Rajma Bowl' }).click();
  await page.getByRole('button', { name: 'Add Tossed Chilli Corn' }).click();

  const cartButton = page.getByRole('button', { name: 'Open cart' });
  await expect(cartButton).toContainText('2 items');
  await expect(cartButton).toContainText('₹210');

  await cartButton.click();
  await expect(page.getByRole('heading', { name: 'Your Cart' })).toBeVisible();
  const cartRows = page.locator('.cart-row');
  await expect(cartRows).toHaveCount(2);
  await expect(cartRows.filter({ hasText: 'Rajma Bowl' })).toHaveCount(1);
  await expect(cartRows.filter({ hasText: 'Tossed Chilli Corn' })).toHaveCount(1);
  await expect(page.locator('.drawer-footer')).toContainText('₹210');

  await cartRows.filter({ hasText: 'Rajma Bowl' }).getByRole('button', { name: 'Remove Rajma Bowl' }).click();
  await expect(cartRows).toHaveCount(1);
  await expect(cartRows.filter({ hasText: 'Tossed Chilli Corn' })).toHaveCount(1);
  await expect(page.locator('.drawer-footer')).toContainText('₹80');

  await page.getByRole('button', { name: 'Proceed to pay' }).click();
  await page.waitForURL(/\/success\?orderId=/);

  const successCard = page.locator('.success-card');
  await expect(page.getByText('Payment received')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Order Confirmed/ })).toBeVisible();
  await expect(page.getByText('Show this pickup code at the Neubar counter.')).toBeVisible();
  await expect(page.locator('.pickup-code')).toHaveText(/^\d{4}$/);
  await expect(successCard).toContainText('Order:');
  await expect(successCard).toContainText('₹80');
});
