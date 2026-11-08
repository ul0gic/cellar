// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot see Playwright's CommonJS named exports
import { chromium } from 'playwright';

const base = process.argv[2];
const say = (...parts) => process.stdout.write(`${parts.join(' ')}\n`);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const logs = [];
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
const reqs = [];
page.on('response', (r) => {
  if (r.url().includes('/api/')) reqs.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
});
await page.goto(`${base}/`);
await page.waitForTimeout(1500);
say('fresh url:', page.url());
say('title/body:', (await page.locator('body').allInnerTexts()).join('').slice(0, 200).replace(/\n/g, ' | '));
say(reqs.join('\n'));
say('console:', JSON.stringify(logs));
await browser.close();
