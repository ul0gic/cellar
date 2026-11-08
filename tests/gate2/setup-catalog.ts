import { Client, out } from './lib.ts';

const c = new Client();
const t0 = performance.now();
const r = await c.post('/api/v1/setup', {
  ownerName: 'Owner',
  password: 'owner-password-2',
  requireLogin: true,
  loadCatalog: true,
});
out('setup', r.status, JSON.stringify(r.json?.catalogJob));
const id = r.json.catalogJob.id;
for (;;) {
  const j = await c.get(`/api/v1/jobs/${id}`);
  if (['done', 'failed', 'succeeded', 'complete'].includes(j.json.state ?? j.json.status)) {
    out('job', j.text.slice(0, 400));
    break;
  }
  await new Promise((s) => setTimeout(s, 500));
}
out('elapsed s', (performance.now() - t0) / 1000);
