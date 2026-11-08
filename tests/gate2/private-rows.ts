import { writeFileSync } from 'node:fs';
import { Client, out } from './lib.ts';
import { ingredient, ownerClient, recipe } from './fx.ts';

const state = process.argv[2];
const owner = await ownerClient();
// rare names so the display grep for member names has no false positives
await owner.patch('/api/v1/members/1', { name: 'Mortimer Vale' });
const mk = async (name: string, password: string) => {
  const r = await owner.post('/api/v1/members', { name, password });
  if (r.status !== 201) throw new Error(`${name} ${r.status} ${r.text}`);
  const id: number = r.json.id;
  return id;
};
const samId = 2;
await owner.patch(`/api/v1/members/${samId}`, { name: 'Quentin Sage' });
const patId = await mk('Philippa Ward', 'pat-password-123');
const sam = new Client();
out('sam login', (await sam.post('/api/v1/session', { name: 'Quentin Sage', password: 'sam-password-1' })).status);
const pat = new Client();
out('pat login', (await pat.post('/api/v1/session', { name: 'Philippa Ward', password: 'pat-password-123' })).status);
const own = new Client();
out('owner login', (await own.post('/api/v1/session', { name: 'Mortimer Vale', password: 'owner-password-2' })).status);

const gin = await ingredient(owner, 'PR Gin');
const lime = await ingredient(owner, 'PR Lime');
const tonic = await ingredient(owner, 'PR Tonic');
const R = await recipe(owner, 'PR Highball', [{ ing: gin }, { ing: tonic }]);
const R2 = await recipe(owner, 'PR Solo Sour', [{ ing: gin }, { ing: lime }]);
const R3 = await recipe(owner, 'PR Unrated Fizz', [{ ing: tonic }]);
// priced bottle so a price exists (4731 minor = 47.31)
const bid = await owner.post('/api/v1/bottles', {
  name: 'PR Gin Bottle',
  ingredientId: gin,
  labeledSize: '750 ml',
  volumeMl: 750,
  abv: 40,
  pricePaidMinor: 4731,
  purchasedOn: '2026-10-01',
  openedOn: null,
  note: 'bottle-note-ZQXBOTTLE',
  imageId: null,
  status: 'sealed',
  count: 1,
});
out('bottle', bid.status);
await owner.patch('/api/v1/me', { showPrices: true });

const note = (text: string, visibility: 'private' | 'household') => ({
  text,
  tastedOn: '2026-11-01',
  descriptorIds: [],
  verdict: 'recommend',
  visibility,
});
const rate = (c: Client, kind: string, id: number, value: number, visibility: string) =>
  c.put(`/api/v1/${kind}/${id}/rating`, { value, visibility });
const results: Record<string, number> = {};
results.n1 = (await owner.post(`/api/v1/recipes/${R}/notes`, note('ZQXPRIV-OWNER-NOTE-R', 'private'))).status;
results.n2 = (await sam.post(`/api/v1/recipes/${R}/notes`, note('ZQXPRIV-SAM-NOTE-R', 'private'))).status;
results.n3 = (await sam.post(`/api/v1/recipes/${R}/notes`, note('ZQXHOUSE-SAM-NOTE-R', 'household'))).status;
results.n4 = (await sam.post(`/api/v1/recipes/${R2}/notes`, note('ZQXPRIV-SAM-NOTE-R2', 'private'))).status;
results.n5 = (await owner.post(`/api/v1/ingredients/${gin}/notes`, note('ZQXPRIV-OWNER-NOTE-GIN', 'private'))).status;
results.n6 = (await sam.post(`/api/v1/ingredients/${gin}/notes`, note('ZQXHOUSE-SAM-NOTE-GIN', 'household'))).status;
results.r1 = (await rate(owner, 'recipes', R, 2, 'private')).status;
results.r2 = (await rate(sam, 'recipes', R, 5, 'private')).status;
results.r3 = (await rate(pat, 'recipes', R, 4, 'household')).status;
results.r4 = (await rate(sam, 'recipes', R2, 5, 'private')).status;
results.r5 = (await rate(sam, 'ingredients', lime, 4.5, 'private')).status;
results.r6 = (await rate(owner, 'ingredients', gin, 1, 'private')).status;
results.r7 = (await rate(pat, 'ingredients', gin, 3, 'household')).status;
out('writes', results);

const menu = await owner.post('/api/v1/menus', {
  name: 'PR Party',
  date: '2026-11-20',
  sections: [
    {
      name: 'Highballs',
      items: [
        { kind: 'recipe', recipeId: R, hostNote: 'Host says try the highball', hideWhenUnavailable: false },
        { kind: 'recipe', recipeId: R2, hostNote: '', hideWhenUnavailable: false },
        { kind: 'ingredient', ingredientId: gin, hostNote: '', hideWhenUnavailable: false },
      ],
    },
  ],
});
out('menu', menu.status, menu.text.slice(0, 200));
const live = await owner.post(`/api/v1/menus/${menu.json.id}/live`);
out('live', live.status, live.text.slice(0, 300));
writeFileSync(
  state,
  JSON.stringify(
    { samId, patId, gin, lime, tonic, R, R2, R3, menuId: menu.json.id, link: live.json?.link ?? live.json },
    null,
    1,
  ),
);
