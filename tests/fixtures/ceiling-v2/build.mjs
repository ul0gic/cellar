const BASE = process.env.CELLAR_BASE ?? 'http://localhost:8081';
const SCALE = Number(process.env.SCALE ?? '1');
const N = (n) => Math.max(1, Math.round(n * SCALE));
const PASSWORD = 'correct horse battery 1';

class Client {
  cookie = '';
  async call(method, path, body) {
    const headers = this.cookie ? { cookie: this.cookie } : {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) this.cookie = c.split(';')[0];
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (res.status >= 400) throw new Error(`${method} ${path} ${res.status} ${text.slice(0, 300)}`);
    return json;
  }
}

async function pool(items, width, work) {
  let next = 0;
  const results = new Array(items.length);
  await Promise.all(
    Array.from({ length: width }, async () => {
      for (;;) {
        const at = next++;
        if (at >= items.length) return;
        results[at] = await work(items[at], at);
      }
    }),
  );
  return results;
}

let seed = 12345;
const rand = (n) => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed % n;
};
const pick = (list) => list[rand(list.length)];
const t0 = performance.now();
const log = (m) => process.stdout.write(`[${((performance.now() - t0) / 1000).toFixed(1)}s] ${m}\n`);

const owner = new Client();
const setup = await owner.call('POST', '/api/v1/setup', {
  ownerName: 'Owner',
  password: PASSWORD,
  requireLogin: false,
  loadCatalog: true,
});
const jobId = setup.catalogJob.id;
for (;;) {
  const job = await owner.call('GET', `/api/v1/jobs/${jobId}`);
  if (job.state !== 'running') {
    if (job.state !== 'succeeded') throw new Error('catalog load failed');
    break;
  }
  await new Promise((r) => setTimeout(r, 200));
}
log('catalog loaded');

const memberIds = [setup.session.person.id];
for (let i = 1; i < 8; i++) {
  const m = await owner.call('POST', '/api/v1/members', { name: `Member ${i}`, password: null });
  memberIds.push(m.id ?? m.person?.id);
}
log(`members ${memberIds.length}`);
const clients = [owner];
for (const id of memberIds.slice(1)) {
  const c = new Client();
  await c.call('POST', '/api/v1/session/profile', { memberId: id });
  clients.push(c);
}

const catalogIngredients = (await owner.call('GET', '/api/v1/ingredients?pageSize=100&page=1')).total;
const allIngredientIds = [];
for (let page = 1; page <= 20; page++) {
  const r = await owner.call('GET', `/api/v1/ingredients?pageSize=100&page=${page}`);
  for (const i of r.items) allIngredientIds.push(i.id);
  if (r.items.length < 100) break;
}
log(`catalog ingredients ${catalogIngredients} (${allIngredientIds.length} ids)`);

const householdIngredients = [];
const ing = Array.from({ length: N(1000) }, (_, i) => i);
const created = await pool(ing, 8, async (i) => {
  const r = await owner.call('POST', '/api/v1/ingredients', {
    name: `Ceiling Ingredient ${String(i).padStart(4, '0')}`,
    parentId: null,
    strength: rand(41),
    description: `Household ingredient ${i}`,
    origin: 'Fixture',
    color: null,
    defaultUnit: 'oz',
    imageId: null,
    parts: [],
  });
  return r.id;
});
householdIngredients.push(...created);
allIngredientIds.push(...created);
log(`household ingredients ${created.length}`);

const glasses = (await owner.call('GET', '/api/v1/glasses')).items.map((g) => g.id);
const methods = (await owner.call('GET', '/api/v1/methods')).items.map((g) => g.id);
const units = ['oz', 'ml', 'dash', 'tsp', 'cl'];
const recipeIds = [];
const recs = Array.from({ length: N(2000) }, (_, i) => i);
const madeRecipes = await pool(recs, 8, async (i) => {
  const lineCount = 3 + rand(4);
  const lines = Array.from({ length: lineCount }, () => ({
    ingredientId: pick(allIngredientIds),
    amount: 1 + rand(4),
    amountMax: null,
    unit: pick(units),
    optional: false,
    specified: false,
    note: '',
    substitutes: [],
  }));
  const r = await pool([0], 1, () =>
    owner.call('POST', '/api/v1/recipes', {
      name: `Ceiling Recipe ${String(i).padStart(4, '0')}`,
      description: `Household recipe ${i}`,
      instructions: '1. Shake with ice.\n2. Strain.',
      garnish: '',
      source: '',
      year: null,
      glassId: pick(glasses),
      methodId: pick(methods),
      utensilIds: [],
      tags: ['Fixture'],
      imageIds: [],
      parentId: null,
      lines,
    }),
  );
  return r[0].id;
});
recipeIds.push(...madeRecipes);
log(`household recipes ${recipeIds.length}`);
const allRecipes = [];
for (let page = 1; page <= 40; page++) {
  const r = await owner.call('GET', `/api/v1/recipes?pageSize=100&page=${page}`);
  for (const x of r.items) allRecipes.push(x.id);
  if (r.items.length < 100) break;
}
log(`recipes in book ${allRecipes.length}`);

const bottleIds = [];
const bottleCalls = Array.from({ length: N(100) }, (_, i) => i);
await pool(bottleCalls, 4, async (i) => {
  const r = await owner.call('POST', '/api/v1/bottles', {
    name: `Ceiling Bottle ${i}`,
    ingredientId: pick(allIngredientIds),
    labeledSize: '750 ml',
    volumeMl: 750,
    abv: 40,
    purchasedOn: '2026-01-15',
    openedOn: null,
    note: '',
    imageId: null,
    status: 'sealed',
    count: 50,
    pricePaidMinor: null,
  });
  for (const b of r.bottles ?? r.items ?? r.ids ?? []) bottleIds.push(typeof b === 'object' ? b.id : b);
});
log(`bottles ${bottleIds.length}`);
const toFinish = bottleIds.slice(0, N(3000));
for (let i = 0; i < toFinish.length; i += 500) {
  await owner.call('POST', '/api/v1/bottles/bulk', {
    action: 'finish',
    ids: toFinish.slice(i, i + 500),
    on: '2026-06-01',
  });
}
log(`bottles finished ${toFinish.length}`);

const noteJobs = Array.from({ length: N(10000) }, (_, i) => i);
await pool(noteJobs, 8, async (i) => {
  const who = clients[i % clients.length];
  await who.call('POST', `/api/v1/recipes/${pick(allRecipes)}/notes`, {
    text: `Tasting note ${i}: balanced, bright, a little dry.`,
    tastedOn: '2026-10-01',
    descriptorIds: [],
    verdict: null,
    visibility: i % 3 === 0 ? 'private' : 'household',
  });
});
log(`notes ${noteJobs.length}`);
let rated = 0;
const ratingJobs = [];
const seen = new Set();
while (ratingJobs.length < N(10000)) {
  const who = rand(clients.length);
  const rec = pick(allRecipes);
  const key = `${who}:${rec}`;
  if (seen.has(key)) continue;
  seen.add(key);
  ratingJobs.push([who, rec]);
}
await pool(ratingJobs, 8, async ([who, rec]) => {
  await clients[who].call('PUT', `/api/v1/recipes/${rec}/rating`, {
    value: 1 + rand(9) / 2,
    visibility: rand(4) === 0 ? 'private' : 'household',
  });
  rated++;
});
log(`ratings ${rated}`);

const madeJobs = Array.from({ length: N(500) }, (_, i) => i);
await pool(madeJobs, 8, async (i) => {
  await clients[i % clients.length].call('POST', `/api/v1/recipes/${pick(allRecipes)}/made-it`);
});
log(`made-it ${madeJobs.length}`);

for (let i = 0; i < N(50); i++) {
  const items = Array.from({ length: 8 }, () => ({
    kind: 'recipe',
    recipeId: pick(allRecipes),
    hostNote: '',
    hideWhenUnavailable: false,
  }));
  await owner.call('POST', '/api/v1/menus', {
    name: `Ceiling Menu ${i}`,
    date: `2026-0${1 + (i % 9)}-15`,
    sections: [
      { name: 'Starters', items: items.slice(0, 4) },
      { name: 'Mains', items: items.slice(4) },
    ],
  });
}
log('menus');
for (let i = 0; i < N(10); i++) {
  const c = await owner.call('POST', '/api/v1/collections', {
    name: `Ceiling Collection ${i}`,
    description: 'Fixture',
  });
  for (let k = 0; k < 20; k++)
    await owner.call('POST', `/api/v1/collections/${c.id}/recipes`, { recipeId: pick(allRecipes) });
}
log('collections');
