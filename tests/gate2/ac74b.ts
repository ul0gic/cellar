import { BASE, out } from './lib.ts';
import { ingredient, ownerClient } from './fx.ts';

const owner = await ownerClient();
const ing = await ingredient(owner, 'AC74 Gin');
const tok = (await owner.post('/api/v1/me/tokens', { name: 'ac74b' })).json.token;
const fd = new FormData();
fd.set(
  'file',
  new Blob([`name,ingredient,volume_ml\nAC74 Test Gin,AC74 Gin,750\n`], { type: 'text/csv' }),
  'bottles.csv',
);
fd.set('kind', 'bottles');
fd.set('mode', 'commit');
fd.set('duplicate', 'skip');
const res = await fetch(`${BASE}/api/v1/import/csv`, {
  method: 'POST',
  headers: { authorization: `Bearer ${tok}`, origin: 'https://evil.example' },
  body: fd,
});
out('bearer + evil Origin importCsv commit', res.status, (await res.text()).slice(0, 300));
const b = await owner.get('/api/v1/bottles');
out(
  'bottles after',
  b.json.items.map((x: { name: string }) => x.name),
  ing,
);
