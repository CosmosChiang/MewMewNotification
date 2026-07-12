const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const data = require('../docs/webstore-screenshots/source/listing-data.js');

(async () => {
  const root = path.resolve(__dirname, '..');
  const screenshotSource = path.join(root, 'docs', 'webstore-screenshots', 'source', 'store-screenshots.html');
  const screenshotOutput = path.dirname(path.dirname(screenshotSource));
  const promoSource = path.join(root, 'docs', 'webstore-promotional', 'source', 'promotional-images.html');
  const promoOutput = path.dirname(path.dirname(promoSource));
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    for (const locale of Object.keys(data.locales)) {
      for (let scene = 1; scene <= 5; scene += 1) {
        await page.goto(`${pathToFileURL(screenshotSource)}?locale=${encodeURIComponent(locale)}&scene=${scene}`, { waitUntil: 'load' });
        await page.waitForFunction(() => window.__STORE_READY__ === true);
        await page.evaluate(() => document.fonts.ready);
        const file = path.join(screenshotOutput, `mewmewnotification-webstore-${locale}-${scene}.png`);
        await page.screenshot({ path: file });
        console.log(path.relative(root, file));
      }
    }

    for (const promo of [
      { name: 'small', width: 440, height: 280 },
      { name: 'marquee', width: 1400, height: 560 }
    ]) {
      await page.setViewportSize({ width: promo.width, height: promo.height });
      await page.goto(`${pathToFileURL(promoSource)}?format=${promo.name}`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__PROMO_READY__ === true);
      const file = path.join(promoOutput, `mewmewnotification-promo-${promo.name}.png`);
      await page.screenshot({ path: file });
      console.log(path.relative(root, file));
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
