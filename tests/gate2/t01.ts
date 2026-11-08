import { Client, out, pct } from './lib.ts';
const ms: number[] = [];
for (let i = 0; i < 20; i++) {
  const r = await new Client().post('/api/v1/session', { name: 'Owner', password: 'owner-password-2' });
  if (r.status !== 200) throw new Error(String(r.status));
  ms.push(r.ms);
}
out(
  'login (verify) wall ms p50',
  pct(ms, 50).toFixed(1),
  'p95',
  pct(ms, 95).toFixed(1),
  'max',
  Math.max(...ms).toFixed(1),
);
