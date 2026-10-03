import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();

try {
  // --- Login ---
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', 'sockprobe@t.dev');
  await page.fill('input[type="password"]', 'probe1234');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(new|trips|$)/, { timeout: 10000 }).catch(() => {});
  check('login lands in app', !page.url().includes('/login'), page.url());

  await page.goto(`${BASE}/new`);
  const box = page.locator('textarea').last();
  await box.waitFor({ state: 'visible', timeout: 10000 });

  // --- Start a chat: things to see in Berlin ---
  await box.fill('what are some things to see in Berlin?');
  await box.press('Enter');

  // Live tool activity — the bar should show a running label BEFORE done
  const liveBar = page.locator('text=/Searching|Working|Thinking/i').first();
  const sawLive = await liveBar.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  check('live tool indicator while searching', sawLive);

  // Wait for the postcard strip (snap-scroll container)
  await page.waitForSelector('div.snap-mandatory button', { timeout: 120000 });
  const cards = await page.locator('div.snap-mandatory button').count();
  check('postcard strip renders', cards > 0, `${cards} cards`);

  // Map pins — exploration pins are rounded-square custom markers
  await page.waitForTimeout(1500);
  const pinCount = await page.locator('.mapboxgl-marker').count();
  check('search pins on map', pinCount >= cards && cards > 0, `${pinCount} pins for ${cards} cards`);

  // Hover card 1 → pin should lift (transform scale in style)
  if (cards > 0) {
    const first = page.locator('div.snap-mandatory button').first();
    await first.hover();
    await page.waitForTimeout(300);
    const lifted = await page.locator('.mapboxgl-marker div[style*="scale(1.25"]').count();
    check('hover card lifts pin', lifted > 0, `${lifted} lifted`);
    // Click → place panel
    await first.click();
    const panel = await page.waitForSelector('text=/Overview/i', { timeout: 8000 }).then(() => true).catch(() => false);
    check('place panel opens', panel);
    await page.click('text=/Back|✕/i').catch(() => page.keyboard.press('Escape')).catch(() => {});
  }

  // Follow-up NON-search message → pins must persist
  const pinsBefore = await page.locator('.mapboxgl-marker').count();
  await box.fill('thank you, that is helpful');
  await box.press('Enter');
  await page.waitForFunction(
    () => !document.querySelector('textarea[disabled]'),
    { timeout: 60000 }
  ).catch(() => {});
  // wait for the new assistant turn to settle (status/thinking gone)
  await page.waitForTimeout(25000);
  const pinsAfter = await page.locator('.mapboxgl-marker').count();
  check('pins persist through non-search turn', pinsAfter >= pinsBefore && pinsBefore > 0, `${pinsBefore} → ${pinsAfter}`);

  // Ask chip from the panel → user bubble should appear in chat
  if (cards > 0) {
    await page.locator('div.snap-mandatory button').first().click().catch(() => {});
    await page.waitForTimeout(1000);
    const chip = page.locator('button:has-text("best time")').first();
    if (await chip.count()) {
      const msgCountBefore = await page.locator('text=best time to visit').count();
      await chip.click();
      await page.waitForTimeout(1500);
      const msgCountAfter = await page.locator('text=best time to visit').count();
      check('ask chip echoes into chat', msgCountAfter > msgCountBefore, `${msgCountBefore}→${msgCountAfter}`);
    } else {
      check('ask chip echoes into chat', false, 'no ask chip found');
    }
  }
} catch (e) {
  check('flow completed without crash', false, String(e).slice(0, 160));
}

const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} checks passed`);
await browser.close();
process.exit(fails ? 1 : 0);
