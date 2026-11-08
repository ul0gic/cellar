import { readFileSync, writeFileSync } from 'node:fs';
import { BASE, Client, out } from './lib.ts';

const st = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const owner = new Client();
await owner.post('/api/v1/session', { name: 'Mortimer Vale', password: 'owner-password-2' });
const anon = new Client();
const tokenOf = (p: string) => p.replace('/m/', '');
let token = tokenOf(st.link.path);

out('token', token, 'length', token.length);
const re = /^[0-9a-hjkmnp-tv-z]{26}$/;
out('matches 26 lowercase Crockford base32', re.test(token));

const page = await anon.get(`/m/${token}`);
out('GET /m/{token}', page.status, page.headers.get('content-type'), page.text.length);
const rec = await anon.get(`/m/${token}/r/${st.R}`);
out('GET /m/{token}/r/R', rec.status, rec.headers.get('content-type'), rec.text.length);
const rec2 = await anon.get(`/m/${token}/r/${st.R2}`);
out('GET /m/{token}/r/R2 (in menu)', rec2.status);
const notin = await anon.get(`/m/${token}/r/${st.R3}`);
out('GET /m/{token}/r/R3 (not in menu)', notin.status, notin.text.slice(0, 80).replace(/\s+/g, ' '));
const state = await anon.get(`/m/${token}/state`);
out('GET /m/{token}/state', state.status, state.text);
writeFileSync('/tmp/m-page.html', page.text);
writeFileSync('/tmp/m-rec.html', rec.text);
writeFileSync('/tmp/m-rec2.html', rec2.text);

const bodies = { page: page.text, rec: rec.text, rec2: rec2.text, state: state.text };
const forbidden = [
  '47.31',
  '4731',
  '$47',
  'ZQX',
  'bottle-note',
  'Mortimer',
  'Quentin',
  'Philippa',
  'Vale',
  'Sage',
  'Ward',
  'PRIV',
  'rating',
  'Rating',
  'average',
  '"mine"',
  'authorId',
  'memberId',
  'createdBy',
  'price',
  'Price',
  'tasted',
  'Tasted',
];
for (const [n, b] of Object.entries(bodies)) {
  const hits = forbidden.filter((f) => b.includes(f));
  out(`forbidden-term hits in ${n}:`, hits);
}
// stars/rating numbers 4 and 5 and 2? check for rating-value text near stars
const present = [
  'PR Party',
  '2026-11-20',
  'Highballs',
  'PR Highball',
  'PR Solo Sour',
  'PR Gin',
  'Host says try the highball',
  'PR Tonic',
  'Stir.',
];
for (const [n, b] of Object.entries(bodies))
  out(
    `menu fields present in ${n}:`,
    present.filter((p) => b.includes(p)),
  );
out(
  'page text (stripped):',
  page.text
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 500),
);
out(
  'rec text (stripped):',
  rec.text
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 600),
);

// other routes with token as credential-like and no cookie
for (const p of [
  `/api/v1/recipes`,
  `/api/v1/menus/${st.menuId}`,
  `/m/${token}/api/v1/recipes`,
  `/m/${token}/../api/v1/recipes`,
  `/m/${token}/x`,
  `/m`,
  `/m/`,
]) {
  const r = await anon.get(p);
  out('anon', p, r.status);
}
// no cookie leakage: Set-Cookie on display
out('set-cookie on display?', page.headers.getSetCookie());
out('headers', Object.fromEntries(page.headers.entries()));

// rotate
const rot = await owner.post(`/api/v1/menus/${st.menuId}/link/rotate`);
out('rotate', rot.status, rot.json?.link?.path);
const newTok = tokenOf(rot.json.link.path);
out('new differs', newTok !== token, re.test(newTok));
const oldAfter = await anon.get(`/m/${token}`);
out(
  'old token page after rotate',
  oldAfter.status,
  oldAfter.text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 200),
);
out(
  'old token state',
  (await anon.get(`/m/${token}/state`)).status,
  'old recipe',
  (await anon.get(`/m/${token}/r/${st.R}`)).status,
);
out('new token page', (await anon.get(`/m/${newTok}`)).status);
token = newTok;
// end
const end = await owner.del(`/api/v1/menus/${st.menuId}/live`);
out('end menu', end.status);
const ended = await anon.get(`/m/${token}`);
out(
  'ended token page',
  ended.status,
  ended.text
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 200),
);
out(
  'ended state',
  (await anon.get(`/m/${token}/state`)).status,
  'recipe',
  (await anon.get(`/m/${token}/r/${st.R}`)).status,
);
// live again and revoke by end? "revoking" = rotate/end. relive:
const again = await owner.post(`/api/v1/menus/${st.menuId}/live`);
out('relive', again.status, again.json?.link?.path, 'same token as ended?', again.json?.link?.path === `/m/${token}`);
out('ended token after relive', (await anon.get(`/m/${token}`)).status);
// token distribution
const toks = new Set<string>();
let allOk = true;
for (let i = 0; i < 40; i++) {
  const r = await owner.post(`/api/v1/menus/${st.menuId}/link/rotate`);
  const t = tokenOf(r.json.link.path);
  toks.add(t);
  if (!re.test(t)) allOk = false;
}
out('40 rotations: distinct', toks.size, 'all match pattern', allOk);
const chars = new Set([...toks].join(''));
out('alphabet seen', [...chars].sort().join(''));
out(BASE);
