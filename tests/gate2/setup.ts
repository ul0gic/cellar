import { Client, out } from './lib.ts';

const c = new Client();
const loadCatalog = process.argv[2] === 'catalog';
const r = await c.post('/api/v1/setup', {
  ownerName: 'Owner',
  password: 'owner-password-2',
  requireLogin: true,
  loadCatalog,
});
out(r.status, r.text.slice(0, 300));
