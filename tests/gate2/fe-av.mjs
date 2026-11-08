// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot see Playwright's CommonJS named exports
import { chromium } from 'playwright';

const base = 'http://localhost:8082';
const say = (...parts) => process.stdout.write(`${parts.join(' ')}\n`);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.request.post(`${base}/api/v1/session`, { data: { name: 'Owner', password: 'owner-password-2' } });
const page = await ctx.newPage();
await page.goto(`${base}/more`);
await page.waitForTimeout(1500);
say(await page.locator('.cl-avatar-button').evaluate((e) => e.outerHTML.replace(/<!--.*?-->/gs, '').slice(0, 800)));
say((await page.locator('.cl-avatar-button').allInnerTexts()).join(''));
await browser.close();
