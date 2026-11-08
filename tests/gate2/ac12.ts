import { Client, out } from './lib.ts';

const otp = process.argv[2];
const old = new Client();
out(
  'old password login after reset',
  (await old.post('/api/v1/session', { name: 'Owner', password: 'owner-password-1' })).status,
);
const c = new Client();
const l = await c.post('/api/v1/session', { name: 'Owner', password: otp });
out('login with one-time password', l.status, 'mustChangePassword=', l.json?.person?.mustChangePassword);
const r = await c.get('/api/v1/recipes');
out('GET /recipes before change', r.status, r.json?.code);
const m = await c.get('/api/v1/bottles');
out('GET /bottles before change', m.status, m.json?.code);
out('GET /session allowed', (await c.get('/api/v1/session')).status);
const bad = await c.put('/api/v1/me/password', { currentPassword: otp, newPassword: 'short' });
out('weak new password', bad.status, bad.json?.code);
const ch = await c.put('/api/v1/me/password', { currentPassword: otp, newPassword: 'owner-password-2' });
out('change password', ch.status);
out('GET /recipes after change', (await c.get('/api/v1/recipes')).status);
const again = new Client();
out('otp login after change', (await again.post('/api/v1/session', { name: 'Owner', password: otp })).status);
out(
  'new password login',
  (await new Client().post('/api/v1/session', { name: 'Owner', password: 'owner-password-2' })).status,
);
