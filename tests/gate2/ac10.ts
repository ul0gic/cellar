import { Client, out } from './lib.ts';
import { ownerClient } from './fx.ts';

const owner = await ownerClient();
const mk = await owner.post('/api/v1/members', { name: 'Sam', password: 'sam-password-1' });
out('create Sam', mk.status);
const anon = () => new Client();
const seq: string[] = [];
const t0 = Date.now();
for (let i = 1; i <= 12; i++) {
  const r = await anon().post('/api/v1/session', { name: 'Owner', password: `wrong-password-${i}` });
  seq.push(
    `${i}:${r.status}${r.status === 429 ? `(retry ${r.json?.retryAfterSeconds}, hdr ${r.headers.get('retry-after')})` : ''}`,
  );
}
out('Owner wrong password attempts', seq.join(' '));
const ok = await anon().post('/api/v1/session', { name: 'Owner', password: 'owner-password-2' });
out('Owner CORRECT password during block', ok.status, ok.text.slice(0, 260));
await new Promise((r) => setTimeout(r, 3000));
const again = await anon().post('/api/v1/session', { name: 'Owner', password: 'owner-password-2' });
out('3 s later, correct again', again.status, again.json?.retryAfterSeconds);
const sam = await anon().post('/api/v1/session', { name: 'Sam', password: 'sam-password-1' });
out('Sam (other account, same address, 10-12 failures so far) correct password', sam.status);
// address-level
const seq2: string[] = [];
let firstBlock = 0;
let n = 0;
for (let i = 1; i <= 45; i++) {
  const r = await anon().post('/api/v1/session', { name: `ghost${i}`, password: 'nope-nope-nope' });
  n++;
  seq2.push(String(r.status));
  if (r.status === 429 && firstBlock === 0) firstBlock = n;
}
out('ghost attempts (unique unknown names)', seq2.join(' '));
out('first 429 at ghost attempt', firstBlock);
const sam2 = await anon().post('/api/v1/session', { name: 'Sam', password: 'sam-password-1' });
out('Sam correct password during address block', sam2.status, sam2.json?.retryAfterSeconds, sam2.json?.code);
out('existing owner cookie session still works', (await owner.get('/api/v1/me')).status);
out('elapsed s', (Date.now() - t0) / 1000);
