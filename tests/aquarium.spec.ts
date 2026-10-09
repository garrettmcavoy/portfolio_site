import { test, expect, type Page } from '@playwright/test';

async function trackAudio(page: Page) {
  await page.addInitScript(() => {
    const events = { tones: 0, loops: [] as { loop: boolean; duration: number }[], ended: [] as boolean[] };
    (window as unknown as { audioEvents: typeof events }).audioEvents = events;
    const oscillators = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const oscillator = oscillators.call(this), start = oscillator.start.bind(oscillator);
      oscillator.start = time => { events.tones++; start(time); };
      return oscillator;
    };
    const sources = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = sources.call(this), start = source.start.bind(source);
      source.addEventListener('ended', () => events.ended.push(source.loop));
      source.start = (...args) => { events.loops.push({ loop: source.loop, duration: source.buffer!.duration }); start(...args); };
      return source;
    };
  });
}

test('home aquarium renders, animates, and follows reduced-motion changes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const tank = page.locator('[data-aquarium]');
  await expect(tank).toHaveAttribute('data-ready', '');
  const canvas = tank.locator('canvas');
  // Controls overlap the canvas; compare the scene independently of hover/focus fades.
  const screenshot = () => canvas.screenshot({ style: '.aquarium-controls { visibility: hidden !important; }' });
  const first = await screenshot();
  await expect.poll(async () => (await screenshot()).equals(first)).toBe(false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  // Media changes and queued GPU frames can settle asynchronously, especially
  // with mobile emulation and software rendering on a shared CI runner.
  await expect.poll(async () => {
    const still = await screenshot();
    return (await screenshot()).equals(still);
  }, { timeout: 10000 }).toBe(true);
  const paused = await screenshot();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(async () => (await screenshot()).equals(paused)).toBe(false);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/photography/');
  await page.goBack();
  await expect(tank).toHaveAttribute('data-ready', '');
  const restored = await screenshot();
  await expect.poll(async () => (await screenshot()).equals(restored)).toBe(false);
});

test('aquarium starts still when reduced motion is preferred', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('[data-aquarium]')).toHaveAttribute('data-ready', '');
  const canvas = page.locator('[data-aquarium] canvas');
  expect((await canvas.screenshot()).equals(await canvas.screenshot())).toBe(true);
});

test('a static reef remains available without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto('/');
  const poster = page.locator('.aquarium-poster');
  await expect(poster).toBeVisible();
  expect(await poster.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1024);
  await expect(page.locator('.aquarium-controls')).toBeHidden();
  await context.close();
});

test('home fills the window and keeps white navigation during resizing', async ({ page }) => {
  await page.goto('/');
  const tank = page.locator('[data-aquarium]');
  await expect(tank).toHaveAttribute('data-ready', '');
  for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 1200, height: 600 }]) {
    await page.setViewportSize(size);
    await expect.poll(() => tank.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const canvas = element.querySelector('canvas')!;
      const density = Math.min(devicePixelRatio, 1.5);
      return rect.x === 0 && rect.y === 0 && rect.width === innerWidth && rect.height === innerHeight
        && canvas.width === Math.floor(innerWidth*density) && canvas.height === Math.floor(innerHeight*density)
        && document.documentElement.scrollWidth === innerWidth && document.documentElement.scrollHeight === innerHeight;
    })).toBe(true);
    await expect(page.locator('.site-title a')).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(page.getByRole('link', { name: 'Home', exact: true })).toHaveCSS('color', 'rgb(255, 255, 255)');
    await page.locator('nav summary').click();
    await expect(page.getByRole('link', { name: 'Photography', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Photography', exact: true })).toHaveCSS('color', 'rgb(255, 255, 255)');
    await page.locator('nav summary').click();
    await expect(page.getByRole('link', { name: 'Photography', exact: true })).toBeHidden();
  }
  await page.goto('/photography/');
  await expect(page.locator('.site-title a')).toHaveCSS('color', 'rgb(0, 0, 0)');
});

test('top-right icons replace old controls and background choices persist', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('[data-aquarium]')).toHaveAttribute('data-ready', '');
  await expect(page.locator('[data-pause], [data-fullscreen], [data-light]')).toHaveCount(0);
  const controls = await page.locator('.aquarium-controls').boundingBox();
  const viewport = page.viewportSize()!;
  expect(controls!.y).toBeLessThan(20);
  expect(viewport.width-controls!.x-controls!.width).toBeLessThan(20);
  await expect(page.getByRole('button', { name: 'Mute aquarium sound', exact: true })).toHaveAttribute('aria-pressed', 'false');
  const screenshot = () => page.locator('[data-aquarium] canvas').screenshot({ style: '.aquarium-controls { visibility: hidden !important; }' });
  for (const preset of ['blue', 'lagoon', 'dusk', 'night', 'black']) {
    await page.locator('.aquarium-settings summary').click();
    const before = await screenshot();
    await page.locator(`[data-background][value="${preset}"]`).check();
    await expect(page.locator('.aquarium-settings')).not.toHaveAttribute('open', '');
    await expect.poll(async () => (await screenshot()).equals(before)).toBe(false);
  }
  await page.reload();
  await expect(page.locator('[data-aquarium]')).toHaveAttribute('data-ready', '');
  await page.locator('.aquarium-settings summary').click();
  await expect(page.getByRole('radio', { name: 'Black', exact: true })).toBeChecked();
  await page.locator('.aquarium-settings summary').press('Escape');
  await expect(page.locator('.settings-panel')).toBeHidden();
  await page.locator('.aquarium-settings summary').click();
  await page.locator('nav summary').click();
  await expect(page.locator('.settings-panel')).toBeHidden();
});

test('aquarium taps start on press, include the reef, exclude navigation and controls, and respect mute', async ({ page, isMobile }) => {
  await trackAudio(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto('/');
  await expect(page.locator('[data-aquarium]')).toHaveAttribute('data-ready', '');
  const events = () => page.evaluate(() => (window as unknown as { audioEvents: { tones: number; loops: { loop: boolean; duration: number }[] } }).audioEvents);
  const tap = (x: number, y: number) => isMobile ? page.touchscreen.tap(x, y) : page.mouse.click(x, y);
  expect((await events()).tones).toBe(0);
  await page.mouse.move(600, 30);
  await page.mouse.down();
  await expect.poll(async () => (await events()).tones).toBe(3);
  await page.mouse.up();
  expect((await events()).tones).toBe(3);
  // Bubble ambience is already enabled; the first gesture unlocks autoplay.
  await expect.poll(async () => (await events()).loops.length).toBe(1);
  expect((await events()).loops[0].loop).toBe(true);
  expect((await events()).loops[0].duration).toBeGreaterThan(7);
  await tap(600, 840);
  await expect.poll(async () => (await events()).tones).toBe(6);
  await page.locator('nav summary').click();
  expect((await events()).tones).toBe(6);
  await page.locator('nav summary').click();
  await page.locator('.aquarium-settings summary').click();
  await page.getByRole('radio', { name: 'Blue water', exact: true }).check();
  expect((await events()).tones).toBe(6);
  const speaker = page.locator('[data-sound]');
  await speaker.click();
  await expect(speaker).toHaveAttribute('aria-label', 'Unmute aquarium sound');
  await expect(speaker.locator('.sound-muted')).toBeVisible();
  await expect(speaker.locator('.sound-waves')).toBeHidden();
  await tap(600, 30);
  expect((await events()).tones).toBe(6);
  await speaker.click();
  await expect(speaker).toHaveAttribute('aria-label', 'Mute aquarium sound');
  await expect(speaker.locator('.sound-waves')).toBeVisible();
  await expect(speaker.locator('.sound-muted')).toBeHidden();
  await expect.poll(async () => (await events()).loops.length).toBe(2);
  await tap(600, 30);
  await expect.poll(async () => (await events()).tones).toBe(9);
});


test('mute and unmute survive page navigation, reloads, and background changes', async ({ page }) => {
  await trackAudio(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const speaker = page.locator('[data-sound]');
  const ready = () => expect(page.locator('[data-aquarium]')).toHaveAttribute('data-ready', '');
  const events = () => page.evaluate(() => (window as unknown as { audioEvents: { tones: number; loops: unknown[] } }).audioEvents);
  const roundTrip = async () => {
    await page.getByRole('link', { name: 'CV', exact: true }).click();
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await ready();
  };
  await page.goto('/');
  await ready();
  await speaker.click();
  await page.locator('.aquarium-settings summary').click();
  await page.getByRole('radio', { name: 'Blue water', exact: true }).check();
  await roundTrip();
  await expect(speaker).toHaveAttribute('aria-label', 'Unmute aquarium sound');
  await expect(speaker.locator('.sound-muted')).toBeVisible();
  await page.locator('[data-aquarium] canvas').click();
  expect((await events()).tones).toBe(0);
  expect((await events()).loops).toHaveLength(0);
  await page.reload();
  await ready();
  await expect(speaker).toHaveAttribute('aria-pressed', 'true');
  await speaker.click();
  await roundTrip();
  await expect(speaker).toHaveAttribute('aria-label', 'Mute aquarium sound');
  await expect(speaker.locator('.sound-waves')).toBeVisible();
  await page.locator('.aquarium-settings summary').click();
  await expect(page.getByRole('radio', { name: 'Blue water', exact: true })).toBeChecked();
  await page.locator('.aquarium-settings summary').click();
  await page.locator('[data-aquarium] canvas').click();
  await expect.poll(async () => (await events()).tones).toBe(3);
  await expect.poll(async () => (await events()).loops.length).toBe(1);
  await page.reload();
  await ready();
  await expect(speaker).toHaveAttribute('aria-pressed', 'false');
});


test('the edited voice plays on every tenth glass tap without stacking and respects mute', async ({ page, isMobile }) => {
  await trackAudio(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let voiceRequests = 0;
  page.on('request', request => { if (request.url().endsWith('/aquarium/glass-warning.mp3')) voiceRequests++; });
  await page.goto('/');
  await expect(page.locator('[data-aquarium]')).toHaveAttribute('data-ready', '');
  expect(voiceRequests).toBe(0);
  const { width, height } = page.viewportSize()!;
  const tap = () => isMobile ? page.touchscreen.tap(width/2, height/2) : page.mouse.click(width/2, height/2);
  const events = () => page.evaluate(() => (window as unknown as { audioEvents: { tones: number; loops: { loop: boolean; duration: number }[]; ended: boolean[] } }).audioEvents);
  const voices = async () => (await events()).loops.filter(source => !source.loop);
  for (let i = 0; i < 9; i++) await tap();
  expect((await events()).tones).toBe(27);
  expect(await voices()).toHaveLength(0);
  expect(voiceRequests).toBe(1);
  await page.locator('nav summary').click();
  await page.locator('nav summary').click();
  await page.locator('.aquarium-settings summary').click();
  await page.getByRole('radio', { name: 'Blue water', exact: true }).check();
  const speaker = page.locator('[data-sound]');
  await speaker.click(); await speaker.click();
  await tap();
  await expect.poll(async () => (await voices()).length).toBe(1);
  expect((await voices())[0].duration).toBeGreaterThan(4.3);
  expect((await voices())[0].duration).toBeLessThan(4.6);
  // More tapping during the line still makes responsive glass sounds, but
  // cannot restart or layer another copy of the speaking clip.
  for (let i = 0; i < 10; i++) await tap();
  expect((await events()).tones).toBe(60);
  expect(await voices()).toHaveLength(1);
  await speaker.click();
  await expect.poll(async () => (await events()).ended.filter(loop => !loop).length).toBe(1);
  for (let i = 0; i < 5; i++) await tap();
  expect((await events()).tones).toBe(60);
  expect(await voices()).toHaveLength(1);
  await speaker.click();
  for (let i = 0; i < 9; i++) await tap();
  expect(await voices()).toHaveLength(1);
  await tap();
  await expect.poll(async () => (await voices()).length).toBe(2);
  expect((await events()).tones).toBe(90);
  expect(voiceRequests).toBe(1);
});
