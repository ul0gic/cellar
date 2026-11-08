import { readFileSync } from 'node:fs';
import { Client, out } from './lib.ts';
const st = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const mk = async (n: string, p: string) => {
  const c = new Client();
  await c.post('/api/v1/session', { name: n, password: p });
  return c;
};
const owner = await mk('Mortimer Vale', 'owner-password-2');
const sam = await mk('Quentin Sage', 'sam-password-1');
const note = (text: string, visibility: string) => ({
  text,
  tastedOn: '2026-11-01',
  descriptorIds: [],
  verdict: null,
  visibility,
});
out(
  (await owner.post(`/api/v1/recipes/${st.R}/notes`, note('ZQXPRIV-OWNER-NOTE-R', 'private'))).status,
  (await sam.post(`/api/v1/recipes/${st.R}/notes`, note('ZQXPRIV-SAM-NOTE-R', 'private'))).status,
  (await sam.post(`/api/v1/recipes/${st.R}/notes`, note('ZQXHOUSE-SAM-NOTE-R', 'household'))).status,
  (await sam.post(`/api/v1/recipes/${st.R2}/notes`, note('ZQXPRIV-SAM-NOTE-R2', 'private'))).status,
);
