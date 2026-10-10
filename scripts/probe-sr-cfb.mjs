// Probe: SR CFB with long Cloudflare wait + reload retry
import { chromium } from 'playwright';

const URL = 'https://www.sports-reference.com/cfb/schools/ohio-state/2025.html';

const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  let resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  // Give Cloudflare up to ~25s to resolve
  for (let i = 0; i < 5 && resp && resp.status() === 403; i++) {
    await page.waitForTimeout(5000);
    resp = await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => resp);
  }
  await page.waitForTimeout(3000);

  const probe = await page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    return {
      title: document.title,
      tableIds: Array.from(html.matchAll(/<table[^>]*id="([^"]+)"/g)).map((m) => m[1]).slice(0, 30),
      hasPuntReturnsId: /id="punt_returns"/.test(html),
    };
  });
  console.log('HTTP status:', resp?.status());
  console.log(JSON.stringify(probe, null, 2));
} finally {
  await browser.close();
}
