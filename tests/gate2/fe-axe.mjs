// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot see Playwright's CommonJS named exports
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const base = process.env.CELLAR_BASE ?? 'http://localhost:8082';
const password = process.env.CELLAR_PASSWORD ?? 'owner-password-2';
const say = (...parts) => process.stdout.write(`${parts.join(' ')}\n`);
const browser = await chromium.launch();
for (const [label, w, h] of [
  ['m390', 390, 844],
  ['d1440', 1440, 900],
]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.request.post(`${base}/api/v1/session`, { data: { name: 'Owner', password } });
  const page = await ctx.newPage();
  await page.goto(`${base}/more`);
  await page.waitForTimeout(1500);
  const axe = await new AxeBuilder({ page }).analyze();
  for (const v of axe.violations)
    say(label, v.impact, v.id, v.help, JSON.stringify(v.nodes.map((n) => [n.target, n.html.slice(0, 220)])));
  const tabbar = await page.evaluate(() => {
    const found = [];
    for (const el of document.querySelectorAll('.cl-shell-tabs *, .cl-tabbar, [class*=tabbar]')) {
      if (el.tagName === 'A' || el.getAttribute('role') === 'tab')
        found.push(
          `${el.tagName} ${el.className} ${el.getAttribute('aria-label') || ''} ${el.textContent.trim().slice(0, 30)} ${el.getAttribute('href')}`,
        );
    }
    return found;
  });
  say(label, 'tabbar candidates', tabbar.length, tabbar.join('\n  '));
  await ctx.close();
}
await browser.close();
