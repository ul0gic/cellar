// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot see Playwright's CommonJS named exports
import { chromium } from 'playwright';

const base = 'http://localhost:8082';
const say = (...parts) => process.stdout.write(`${parts.join(' ')}\n`);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.request.post(`${base}/api/v1/session`, { data: { name: 'Owner', password: 'owner-password-2' } });
const page = await ctx.newPage();
await page.goto(`${base}/`);
await page.waitForTimeout(1500);
const seq = ['Recipes', 'Shelf', 'More', 'Home', 'Recipes', 'More', 'Shelf', 'Home', 'More', 'Recipes'];
for (const t of seq) {
  await page.locator('a.cl-tab', { hasText: t }).first().click();
  await page.waitForTimeout(500);
}
const m = await page.evaluate(() =>
  performance.getEntriesByName('cellar:navigation').map((e) => [e.detail?.path, Math.round(e.duration * 10) / 10]),
);
say(JSON.stringify(m));
const d = m.map((x) => x[1]).sort((a, b) => a - b);
say('n', d.length, 'min', d[0], 'median', d[Math.floor(d.length / 2)], 'max', d[d.length - 1]);
await browser.close();
