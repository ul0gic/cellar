import { BASE, Client, out } from './lib.ts';

const owner = new Client();
await owner.post('/api/v1/session', { name: 'Owner', password: 'owner-password-1' });
const t = await owner.post('/api/v1/me/tokens', { name: 'ac74' });
const tok: string = t.json.token;
const evil = { origin: 'https://evil.example' };
const csv = 'name,brand,size_ml\nAC74 Test Gin,Acme,750\n';
async function importCsv(headers: Record<string, string>) {
  const fd = new FormData();
  fd.set('file', new Blob([csv], { type: 'text/csv' }), 'bottles.csv');
  fd.set('kind', 'bottles');
  fd.set('mode', 'dry_run');
  fd.set('duplicate', 'skip');
  const res = await fetch(`${BASE}/api/v1/import/csv`, { method: 'POST', headers, body: fd });
  return { status: res.status, text: (await res.text()).slice(0, 300) };
}
const tcsv = await fetch(`${BASE}/api/v1/import/templates/bottles.csv`, {
  headers: { authorization: `Bearer ${tok}` },
});
out('bearer getCsvTemplate', tcsv.status, (await tcsv.text()).split('\n')[0]);
out('bearer + evil Origin, no cookie: importCsv', await importCsv({ authorization: `Bearer ${tok}`, ...evil }));
out('cookie + evil Origin: importCsv', await importCsv({ cookie: owner.cookie, ...evil }));
out('cookie + own Origin: importCsv', await importCsv({ cookie: owner.cookie, origin: BASE }));
for (const [name, path] of [
  ['exportBottles', '/api/v1/export/bottles.csv'],
  ['downloadBackup', '/api/v1/backup'],
  ['exportRecipes', '/api/v1/export/recipes.zip'],
] as const) {
  const res = await fetch(BASE + path, { headers: { authorization: `Bearer ${tok}`, ...evil } });
  const b = await res.arrayBuffer();
  out(`bearer + evil Origin, no cookie: ${name}`, res.status, res.headers.get('content-type'), b.byteLength);
}
const cookieDownload = await fetch(`${BASE}/api/v1/backup`, { headers: { cookie: owner.cookie, ...evil } });
out('cookie + evil Origin GET downloadBackup (reads are not Origin-checked)', cookieDownload.status);
const w = await fetch(`${BASE}/api/v1/bottles`, {
  method: 'POST',
  headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', ...evil },
  body: '{}',
});
out('bearer + evil Origin write createBottles (body invalid on purpose)', w.status, (await w.text()).slice(0, 120));
const wc = await fetch(`${BASE}/api/v1/bottles`, {
  method: 'POST',
  headers: { cookie: owner.cookie, 'content-type': 'application/json', ...evil },
  body: '{}',
});
out('cookie + evil Origin createBottles', wc.status);
