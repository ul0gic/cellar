import { execSync } from 'node:child_process';
import { out, pct } from './lib.ts';
import { ownerClient } from './fx.ts';

const label = process.argv[2] ?? 'run';
const c = await ownerClient();
await new Promise((r) => setTimeout(r, 3000));
const targets: [string, string][] = [
  ['T06 listRecipes can_make', '/api/v1/recipes?pageSize=100&status=can_make'],
  ['T07 getBuyNext', '/api/v1/buy-next?limit=10'],
];
for (const [, p] of targets) for (let i = 0; i < 3; i++) await c.get(p);
const since = new Date().toISOString();
const wall: Record<string, number[]> = {};
let sample = '';
for (const [name, p] of targets) {
  wall[name] = [];
  for (let i = 0; i < 50; i++) {
    const r = await c.get(p);
    if (r.status !== 200) throw new Error(`${p} ${r.status}`);
    wall[name].push(r.ms);
    if (i === 0)
      sample = `${name}: ${p.startsWith('/api/v1/recipes') ? `total ${r.json.total}, facets ${JSON.stringify(r.json.facets)}` : `items ${r.json.items.length}: ${r.json.items.slice(0, 3).map((x: { ingredient: { name: string }; unlocks: number }) => `${x.ingredient.name}:${x.unlocks}`)}`}`;
    if (i === 0) out(sample);
  }
}
const logs = execSync(`docker logs --since ${since} cellar-v1 2>&1`, { maxBuffer: 1 << 28 })
  .toString()
  .split('\n');
const server: Record<string, number[]> = {};
for (const l of logs) {
  if (!l.startsWith('{')) continue;
  const j = JSON.parse(l);
  if (j.msg !== 'request' || j.method !== 'GET') continue;
  const key =
    j.path === '/api/v1/recipes' ? 'T06 listRecipes can_make' : j.path === '/api/v1/buy-next' ? 'T07 getBuyNext' : null;
  if (key) {
    const bucket = server[key] ?? [];
    bucket.push(j.durationMs);
    server[key] = bucket;
  }
}
for (const [name] of targets) {
  const s = server[name] ?? [];
  const w = wall[name];
  out(
    label,
    name,
    `server n=${s.length} p50 ${pct(s, 50)} p95 ${pct(s, 95)} max ${Math.max(...s)} ms | client wall p50 ${pct(w, 50).toFixed(1)} p95 ${pct(w, 95).toFixed(1)} max ${Math.max(...w).toFixed(1)} ms`,
  );
}
