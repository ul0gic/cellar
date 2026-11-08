import { out } from './lib.ts';
import { ownerClient } from './fx.ts';
const c = await ownerClient();
const bl = await c.get('/api/v1/bottles?pageSize=100');
const b = bl.json.items.find((x: { name: string }) => x.name === 'CM Bourbon Bottle');
const f = await c.post(`/api/v1/bottles/${b.id}/finish`, { on: '2026-11-08' });
out('finish bourbon', f.status);
const r = await c.get('/api/v1/recipes?pageSize=100&q=CM');
out('after finish facets', r.json.facets, 'expected canMake 4 missing1 5 missing2 2');
out(['can_make', 'missing_1', 'missing_2'].length);
for (const s of ['can_make', 'missing_1', 'missing_2'])
  out(
    s,
    (await c.get(`/api/v1/recipes?pageSize=100&status=${s}`)).json.items.map(
      (i: { name: string }) => i.name.split(' ')[1],
    ),
  );
const bn = await c.get('/api/v1/buy-next');
out(
  'buy-next',
  bn.json.items.map((i: { ingredient: { name: string }; unlocks: number }) => `${i.ingredient.name}:${i.unlocks}`),
);
const re = await c.post(`/api/v1/bottles/${b.id}/reopen`);
out('reopen', re.status);
out('restored facets', (await c.get('/api/v1/recipes?pageSize=100&q=CM')).json.facets);
