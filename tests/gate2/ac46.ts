import { readFileSync, writeFileSync } from 'node:fs';
import { Client, out, type Reply } from './lib.ts';

const st = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const login = async (n: string, p: string) => {
  const c = new Client();
  const r = await c.post('/api/v1/session', { name: n, password: p });
  if (r.status !== 200) throw new Error(n);
  return c;
};
const viewers: Record<string, Client> = {
  owner: await login('Mortimer Vale', 'owner-password-2'),
  sam: await login('Quentin Sage', 'sam-password-1'),
  pat: await login('Philippa Ward', 'pat-password-123'),
};
const routes = [
  '/api/v1/recipes',
  '/api/v1/recipes?pageSize=100&sort=rating&order=desc',
  '/api/v1/recipes?ratingMin=4.5',
  '/api/v1/recipes?ratingMin=5',
  '/api/v1/recipes?ratingMin=2',
  '/api/v1/recipes?q=ZQXPRIV',
  `/api/v1/recipes/${st.R}`,
  `/api/v1/recipes/${st.R2}`,
  `/api/v1/recipes/${st.R3}`,
  `/api/v1/recipes/${st.R}/notes`,
  `/api/v1/recipes/${st.R2}/notes`,
  `/api/v1/ingredients/${st.gin}`,
  `/api/v1/ingredients/${st.lime}`,
  `/api/v1/ingredients/${st.gin}/notes`,
  `/api/v1/ingredients/${st.lime}/notes`,
  '/api/v1/ingredients',
  '/api/v1/ingredients?sort=recipes',
  '/api/v1/ingredients/tree',
  '/api/v1/search?q=ZQXPRIV',
  '/api/v1/search?q=ZQXHOUSE',
  '/api/v1/search?q=PR',
  '/api/v1/search?q=Highball',
  '/api/v1/home',
  '/api/v1/stats',
  '/api/v1/menus',
  `/api/v1/menus/${st.menuId}`,
  '/api/v1/collections',
  '/api/v1/bottles',
  '/api/v1/buy-next',
  '/api/v1/shopping-list',
  '/api/v1/wishlists',
  '/api/v1/notifications',
  '/api/v1/members',
];
const markers = { owner: 'ZQXPRIV-OWNER', sam: 'ZQXPRIV-SAM' };
const leaks: string[] = [];
const table: string[] = [];
const raw: Record<string, string> = {};
for (const [who, c] of Object.entries(viewers)) {
  for (const r of routes) {
    const res = await c.get(r);
    raw[`${who} ${r}`] = res.text;
    let note = '';
    for (const [owner, m] of Object.entries(markers)) {
      if (owner !== who && res.text.includes(m)) {
        leaks.push(`${who} sees ${m} on ${r}`);
        note += ` LEAK(${m})`;
      }
    }
    table.push(`| ${who} | ${r} | ${res.status} | ${res.text.length}${note} |`);
  }
}
writeFileSync('/tmp/ac46-raw.json', JSON.stringify(raw));
out('leaks', leaks);
// rating oracles
const pick = (who: string, path: string, f: (j: Reply['json']) => unknown) =>
  out(who, path, f(JSON.parse(raw[`${who} ${path}`])));
for (const who of Object.keys(viewers)) {
  pick(who, `/api/v1/recipes/${st.R}`, (j) => ({ mine: j.mine, household: j.household }));
  pick(who, `/api/v1/recipes/${st.R2}`, (j) => ({ mine: j.mine, household: j.household }));
  pick(who, `/api/v1/ingredients/${st.gin}`, (j) => ({ mine: j.mine, household: j.household }));
  pick(who, `/api/v1/ingredients/${st.lime}`, (j) => ({ mine: j.mine, household: j.household }));
  pick(who, '/api/v1/recipes?pageSize=100&sort=rating&order=desc', (j) =>
    j.items.map((i: Reply['json']) => `${i.name}:${JSON.stringify(i.household)}/${JSON.stringify(i.mine?.rating)}`),
  );
  pick(who, '/api/v1/recipes?ratingMin=4.5', (j) => j.items.map((i: Reply['json']) => i.name));
  pick(who, '/api/v1/recipes?ratingMin=5', (j) => j.items.map((i: Reply['json']) => i.name));
  pick(who, '/api/v1/recipes?ratingMin=2', (j) => j.items.map((i: Reply['json']) => i.name));
  pick(who, `/api/v1/recipes/${st.R}/notes`, (j) => j.items.map((n: Reply['json']) => n.text));
  pick(who, `/api/v1/recipes/${st.R2}/notes`, (j) => j.items.map((n: Reply['json']) => n.text));
  pick(who, `/api/v1/ingredients/${st.gin}/notes`, (j) => j.items.map((n: Reply['json']) => n.text));
  pick(who, '/api/v1/stats', (j) => ({
    topRated: j.topRated.map((t: Reply['json']) => `${t.name}:${JSON.stringify(t.rating)}`),
    recent: j.recentTastings.map((t: Reply['json']) => t.note.text),
  }));
  pick(who, '/api/v1/search?q=ZQXPRIV', (j) => JSON.stringify(j).slice(0, 200));
  pick(who, '/api/v1/search?q=ZQXHOUSE', (j) => JSON.stringify(j).slice(0, 200));
}
writeFileSync('/tmp/ac46-table.md', table.join('\n'));
