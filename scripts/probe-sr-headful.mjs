// Probe: SR CFB with headful Chromium (Cloudflare pass-through)
import { chromium } from 'playwright';

const URL = 'https://www.sports-reference.com/cfb/schools/ohio-state/2025.html';

const browser = await chromium.launch({ headless: false });
try {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  let resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });

  for (let i = 0; i < 6 && resp && resp.status() === 403; i++) {
    await page.waitForTimeout(5000);
    try {
      resp = await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
    } catch {
      /* keep waiting */
    }
  }
  await page.waitForTimeout(3000);

  const probe = await page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    return {
      title: document.title,
      tableIds: Array.from(html.matchAll(/<table[^>]*id="([^"]+)"/g)).map((m) => m[1]).slice(0, 40),
      hasPuntReturnsId: /id="punt_returns"/.test(html),
    };
  });
  console.log('HTTP status:', resp?.status());
  console.log(JSON.stringify(probe, null, 2));

  // If we passed, dump the cookies for reuse in a headless context
  if (probe.hasPuntReturnsId) {
    const cookies = await ctx.cookies();
    const fs = await import('node:fs/promises');
    await fs.writeFile('/tmp/sr-cookies.json', JSON.stringify(cookies));
    console.log('cookies saved:', cookies.map((c) => c.name).join(', '));
  }
} finally {
  await browser.close();
}
