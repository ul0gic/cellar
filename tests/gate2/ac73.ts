// biome-ignore lint/correctness/noUnresolvedImports: Biome 2.6.6's Node built-in module list lacks node:sqlite
import { DatabaseSync } from 'node:sqlite';
import { BASE, Client, out } from './lib.ts';

const owner = new Client();
out('owner login', (await owner.post('/api/v1/session', { name: 'Owner', password: 'owner-password-1' })).status);
const mk = await owner.post('/api/v1/members', { name: 'Sam', password: 'sam-password-1' });
out('create member Sam', mk.status, mk.json?.id);
const sam = new Client();
out('sam login', (await sam.post('/api/v1/session', { name: 'Sam', password: 'sam-password-1' })).status);

const ct = await owner.post('/api/v1/me/tokens', { name: 'laptop' });
out(
  'create owner token',
  ct.status,
  JSON.stringify({
    ...ct.json,
    token: `${String(ct.json?.token).slice(0, 8)}...(len ${String(ct.json?.token).length})`,
  }),
);
const ownerTok: string = ct.json.token;
const list1 = await owner.get('/api/v1/me/tokens');
out('list tokens', list1.status, list1.text);
out('list contains plaintext?', list1.text.includes(ownerTok));
const dupGet = await owner.get('/api/v1/me/tokens');
out('plaintext shown again in any later list:', dupGet.text.includes(ownerTok));

const db = new DatabaseSync('../../.rig/v1-data/cellar.db', { readOnly: true });
const cols = db
  .prepare('pragma table_info(api_tokens)')
  .all()
  .map((c) => c.name);
out('api_tokens columns', cols);
const rows = db.prepare('select * from api_tokens').all();
out(
  'rows',
  rows.map((r) => JSON.stringify(r)),
);
const dump = JSON.stringify(rows);
out(
  'db row contains plaintext token:',
  dump.includes(ownerTok),
  ' contains token body part:',
  dump.includes(ownerTok.slice(4)),
);
const everything = db
  .prepare("select name from sqlite_master where type='table'")
  .all()
  .map((t) => String(t.name));
let found = false;
for (const t of everything) {
  if (t.startsWith('sqlite_') || t.includes('fts')) continue;
  const all = JSON.stringify(db.prepare(`select * from "${t}"`).all());
  if (all.includes(ownerTok)) {
    found = true;
    out('PLAINTEXT FOUND in table', t);
  }
}
out('plaintext token present in any table:', found);
db.close();

const tokClient = new Client();
tokClient.bearer = ownerTok;
const me = await tokClient.get('/api/v1/me');
out('GET /me with bearer, no cookie', me.status, me.json?.name, me.json?.role);
const list2 = await owner.get('/api/v1/me/tokens');
out('lastUsedAt after use', list2.json.tokens[0].lastUsedAt, 'created', list2.json.tokens[0].createdAt);

const st = await sam.post('/api/v1/me/tokens', { name: 'sam-phone' });
out('sam token', st.status);
const samTok = new Client();
samTok.bearer = st.json.token;
out('sam token GET /me', (await samTok.get('/api/v1/me')).json?.name);
const bk = await samTok.get('/api/v1/backup');
out('member token on owner route downloadBackup', bk.status, bk.json?.code);
const bk2 = await tokClient.get('/api/v1/backup');
out('owner token on owner route downloadBackup', bk2.status, bk2.headers.get('content-type'), bk2.text.length);
const cm = await samTok.post('/api/v1/members', { name: 'Eve', password: 'eve-password-1' });
out('member token createMember', cm.status, cm.json?.code);
const cm2 = await sam.post('/api/v1/members', { name: 'Eve', password: 'eve-password-1' });
out('member cookie createMember (comparison)', cm2.status, cm2.json?.code);

const rev = await owner.del(`/api/v1/me/tokens/${ct.json.id}`);
out('revoke owner token', rev.status);
const after = await tokClient.get('/api/v1/me');
out('revoked token GET /me', after.status, after.json?.code);
const after2 = await tokClient.get('/api/v1/backup');
out('revoked token backup', after2.status);
const list3 = await owner.get('/api/v1/me/tokens');
out('list after revoke', list3.text);
// someone else's token id revoke
const cross = await owner.del(`/api/v1/me/tokens/${st.json.id}`);
out('owner revoking sam token id via own route', cross.status);
out('sam token still works', (await samTok.get('/api/v1/me')).status);
out(BASE);
