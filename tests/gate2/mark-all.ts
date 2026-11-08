import { out } from './lib.ts';
import { ownerClient } from './fx.ts';
const c = await ownerClient();
const ids: number[] = [];
for (let p = 1; ; p++) {
  const r = await c.get(`/api/v1/ingredients?pageSize=100&page=${p}`);
  for (const i of r.json.items) ids.push(i.id);
  if (r.json.items.length < 100) break;
}
let n = 0;
for (let i = 0; i < ids.length; i += 8) {
  await Promise.all(
    ids.slice(i, i + 8).map(async (id) => {
      const r = await c.put(`/api/v1/ingredients/${id}/on-hand`, { marked: true });
      if (r.status === 200) n++;
    }),
  );
}
out('marked', n, 'of', ids.length);
