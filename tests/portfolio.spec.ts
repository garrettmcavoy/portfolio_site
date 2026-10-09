import { test, expect } from '@playwright/test';

test('gallery reserves space and defers offscreen and enlarged photos', async ({ page }) => {
  const images: string[] = [];
  page.on('request', request => {
    if (request.resourceType() === 'image') images.push(request.url());
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/photography/', { waitUntil: 'networkidle' });
  const photos = page.locator('[data-photo]');
  await expect(photos).toHaveCount(38);
  await expect(photos.first().locator('img')).toBeVisible();
  await expect.poll(() => photos.first().locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(photos.last().locator('template')).toHaveCount(1);
  expect(await photos.first().evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(100);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(images.length).toBeLessThanOrEqual(12);
  const photoBytes = await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => (entry as PerformanceResourceTiming).initiatorType === 'img').reduce((total, entry) => total + (entry as PerformanceResourceTiming).encodedBodySize, 0));
  expect(photoBytes).toBeLessThan(1_000_000);
  expect(images.every(url => !/\.jpe?g(?:$|\?)/i.test(url))).toBe(true);
  const fullSrc = await photos.first().getAttribute('href');
  expect(images.some(url => url.endsWith(fullSrc!))).toBe(false);
  expect(errors).toEqual([]);
});

test('horizontal and vertical scrolling reveal the deferred photographs', async ({ page }) => {
  await page.goto('/photography/');
  const strip = page.locator('.photo-scroll').first();
  await strip.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  const lastInYear = strip.locator('[data-photo]').last();
  await expect(lastInYear.locator('img')).toBeVisible();
  await expect.poll(() => lastInYear.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const last = page.locator('[data-photo]').last();
  await last.scrollIntoViewIfNeeded();
  await expect(last.locator('img')).toBeVisible();
});

test('lightbox supports keyboard close, focus restoration, and repeated opening', async ({ page }) => {
  await page.goto('/photography/');
  const first = page.locator('[data-photo]').first();
  await first.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(first).toBeFocused();
  await first.click();
  await page.getByRole('button', { name: 'Close photograph' }).click();
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
});

test('every local route and its navigation links are available', async ({ page, request }) => {
  for (const route of ['/', '/photography/', '/cv/', '/other/', '/engineering/', '/IME/', '/biketrailer/', '/turbineshaft/']) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(200);
    await page.goto(route);
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), route).toBe(true);
    const links = await page.locator('a[href^="/"]').evaluateAll(links => [...new Set(links.map(link => link.getAttribute('href')!))]);
    for (const link of links) expect((await request.get(link)).status(), link).toBe(200);
  }
});

test('navigation and photographs work without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByText('Portfolio', { exact: true }).click();
  await page.getByRole('link', { name: 'Photography', exact: true }).click();
  await expect(page.locator('[data-photo] img')).toHaveCount(38);
  const href = await page.locator('[data-photo]').first().getAttribute('href');
  const response = await context.request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('image/webp');
  await context.close();
});

test('pointer lightbox interaction does not leave focus boxes', async ({ page }) => {
  await page.goto('/photography/');
  const first = page.locator('[data-photo]').first();
  await first.click();
  const close = page.getByRole('button', { name: 'Close photograph' });
  await expect(close).toBeVisible();
  expect(await close.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none');
  expect(await close.evaluate(el => getComputedStyle(el).boxShadow)).toBe('none');
  await close.click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(first).toBeFocused();
  expect(await first.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none');
  expect(await page.locator('.photo-scroll').first().evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none');
  await page.keyboard.press('Enter');
  await expect(close).toBeFocused();
  expect(await close.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
  await page.keyboard.press('Escape');
  await expect(first).toBeFocused();
  expect(await first.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
});

test('navigation text aligns with the name and Portfolio has no arrow', async ({ page }) => {
  await page.goto('/photography/');
  await page.evaluate(() => document.fonts.ready);
  const titleLeft = await page.locator('.site-title').evaluate(el => el.getBoundingClientRect().left);
  const homeLeft = await page.getByRole('link', { name: 'Home', exact: true }).evaluate(el => el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft));
  expect(Math.abs(titleLeft - homeLeft)).toBeLessThan(1);
  const portfolio = page.locator('nav summary');
  expect(await portfolio.evaluate(el => getComputedStyle(el, '::after').content)).toBe('none');
});
