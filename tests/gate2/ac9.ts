import { readFileSync, writeFileSync } from 'node:fs';
import { BASE, Client, out } from './lib.ts';

const doc = JSON.parse(readFileSync('../../contract/dist/openapi.json', 'utf8'));
const anon = new Client();
const rows: string[] = [];
const methods = ['get', 'post', 'put', 'patch', 'delete'];
let n = 0;
for (const [path, item] of Object.entries<Record<string, { operationId?: string }>>(doc.paths)) {
  for (const m of methods) {
    const op = item[m];
    if (!op?.operationId) continue;
    n++;
    const concrete = path.replace(/\{[^}]+\}/g, '1');
    const r = await anon.call(m.toUpperCase(), concrete, ['get', 'delete'].includes(m) ? undefined : {});
    const code = r.json?.code ?? r.json?.type ?? '';
    rows.push(`| ${op.operationId} | ${m.toUpperCase()} ${path} | ${r.status} | ${String(code).slice(0, 40)} |`);
  }
}
const evil = 'https://evil.example';
const login = new Client();
const lr = await login.post('/api/v1/session', { name: 'Owner', password: 'owner-password-1' });
const lines: string[] = [];
lines.push(`login (no Origin): ${lr.status}`);
const own = new URL(BASE).origin;
const w1 = await login.call('PATCH', '/api/v1/me', { unit: 'ml' }, { origin: evil });
lines.push(`PATCH /api/v1/me with cookie + Origin ${evil}: ${w1.status} ${w1.json?.code ?? ''}`);
const w2 = await login.call('PATCH', '/api/v1/me', { unit: 'oz' }, { origin: own });
lines.push(`PATCH /api/v1/me with cookie + own Origin ${own}: ${w2.status}`);
const w3 = await login.call('PATCH', '/api/v1/me', { unit: 'oz' });
lines.push(`PATCH /api/v1/me with cookie + no Origin: ${w3.status}`);
const w4 = await anon.call('POST', '/api/v1/session', { name: 'Owner', password: 'x' }, { origin: evil });
lines.push(`POST /api/v1/session (login, no credential) + Origin ${evil}: ${w4.status} ${w4.json?.code ?? ''}`);
const w5 = await anon.call('POST', '/api/v1/bottles', {}, { origin: evil });
lines.push(`POST /api/v1/bottles no credential + Origin ${evil}: ${w5.status} ${w5.json?.code ?? ''}`);
const w6 = await login.call('DELETE', '/api/v1/session', undefined, { origin: evil });
lines.push(`DELETE /api/v1/session cookie + Origin ${evil}: ${w6.status} ${w6.json?.code ?? ''}`);
writeFileSync('/tmp/ac9-rows.md', `${rows.join('\n')}\n\n${lines.join('\n')}\n`);
out(n, 'operations');
const tally: Record<string, number> = {};
for (const r of rows) {
  const s = r.split('|')[3].trim();
  tally[s] = (tally[s] ?? 0) + 1;
}
out(tally);
out(lines.join('\n'));
out(rows.filter((r) => !r.split('|')[3].includes('401')).join('\n'));
