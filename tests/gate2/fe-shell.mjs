// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot see Playwright's CommonJS named exports
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const base = process.env.CELLAR_BASE ?? 'http://localhost:8082';
const password = process.env.CELLAR_PASSWORD ?? 'owner-password-2';
const say = (...parts) => process.stdout.write(`${parts.join(' ')}\n`);
const browser = await chromium.launch();
async function run(label, width, height, paths) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const logs = [];
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => logs.push(`requestfailed: ${r.url()}`));
  const login = await ctx.request.post(`${base}/api/v1/session`, {
    data: { name: 'Owner', password },
  });
  say(label, 'login', login.status());
  for (const p of paths) {
    await page.goto(`${base}${p}`);
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => {
      const shell = document.querySelector('lc-app-shell');
      const tabs = [...document.querySelectorAll('[class*="tab"] a, nav a, lc-tab-bar a, [role="tab"], .cl-tabbar a')]
        .map((a) => (a.textContent || '').trim())
        .filter(Boolean);
      const nav = [...document.querySelectorAll('nav')].map((n) => ({
        cls: n.className,
        label: n.getAttribute('aria-label'),
        links: [...n.querySelectorAll('a')].map((a) => `${a.textContent.trim()}>${a.getAttribute('href')}`),
      }));
      return {
        layout: shell?.getAttribute('layout'),
        title: document.querySelector('h1')?.textContent,
        nav,
        tabs: tabs.length,
      };
    });
    say(label, p, '->', page.url(), JSON.stringify(info));
    const axe = await new AxeBuilder({ page }).analyze();
    const bad = axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    say(
      label,
      p,
      'axe violations total',
      axe.violations.length,
      'serious/critical',
      bad.length,
      bad.map((v) => `${v.id}:${v.nodes.length}`).join(','),
    );
    await page.screenshot({ path: `/tmp/fe-${label}-${p.replace(/\W/g, '_')}.png` });
  }
  say(label, 'console', JSON.stringify(logs));
  await ctx.close();
}
await run('m390', 390, 844, ['/', '/more']);
await run('d1440', 1440, 900, ['/', '/more']);
await browser.close();
